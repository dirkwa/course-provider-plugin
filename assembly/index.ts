/**
 * Course Provider Plugin - WASM Version
 *
 * Computes course data (bearing, distance, XTE, VMG, ETA, TTG) for navigation.
 * Ported from the Node.js version to AssemblyScript.
 *
 * Features:
 * - GreatCircle and Rhumbline calculations
 * - Cross-track error calculation
 * - Velocity Made Good to course
 * - Time to Go and ETA calculations
 * - Arrival circle notifications
 * - HTTP endpoint for calcValues
 */

import {
  Plugin,
  setStatus,
  setError,
  debug,
  emit,
  getSelfPath,
  Delta,
  Update,
  PathValue,
  Source,
  Notification,
  NotificationState,
  getCurrentTimestamp
} from 'signalk-assemblyscript-plugin-sdk/assembly'

import {
  LatLon,
  toRadians,
  toDegrees,
  compassAngle,
  angleDifference
} from './geodesy'

// ===== Configuration =====

let configSoundNotifications: bool = false
let configCalcMethod: string = 'GreatCircle' // 'GreatCircle' or 'Rhumbline'

// ===== Navigation State =====

let vesselLat: f64 = 0.0
let vesselLon: f64 = 0.0
let hasVesselPosition: bool = false

let nextPointLat: f64 = 0.0
let nextPointLon: f64 = 0.0
let hasNextPoint: bool = false

let prevPointLat: f64 = 0.0
let prevPointLon: f64 = 0.0
let hasPrevPoint: bool = false

let magneticVariation: f64 = 0.0
let speedOverGround: f64 = 0.0
let courseOverGroundTrue: f64 = 0.0
let windAngleTrueGround: f64 = 0.0
let arrivalCircle: f64 = 0.0

// Arrival circle watcher state
let wasInArrivalCircle: bool = false

// Last calculated values for HTTP endpoint
let lastGcDistance: f64 = 0.0
let lastGcBearingTrue: f64 = 0.0
let lastGcBearingMagnetic: f64 = 0.0
let lastGcBearingTrackTrue: f64 = 0.0
let lastGcBearingTrackMagnetic: f64 = 0.0
let lastGcXte: f64 = 0.0
let lastGcVmg: f64 = 0.0
let lastGcTtg: f64 = 0.0
let lastGcPrevDistance: f64 = 0.0

let lastRlDistance: f64 = 0.0
let lastRlBearingTrue: f64 = 0.0
let lastRlBearingMagnetic: f64 = 0.0
let lastRlBearingTrackTrue: f64 = 0.0
let lastRlBearingTrackMagnetic: f64 = 0.0
let lastRlXte: f64 = 0.0
let lastRlVmg: f64 = 0.0
let lastRlTtg: f64 = 0.0
let lastRlPrevDistance: f64 = 0.0

let hasCalcData: bool = false
let metaSent: bool = false

// ===== Helper Functions =====

function parseFloat64FromJson(json: string, key: string): f64 {
  const searchKey = '"' + key + '":'
  const match = json.indexOf(searchKey)
  if (match < 0) return 0.0

  let start = match + searchKey.length
  // Skip whitespace
  while (start < json.length && (json.charCodeAt(start) === 32 || json.charCodeAt(start) === 9)) {
    start++
  }

  let end = start
  while (end < json.length) {
    const c = json.charCodeAt(end)
    if ((c >= 48 && c <= 57) || c === 46 || c === 45 || c === 43 || c === 101 || c === 69) {
      end++
    } else {
      break
    }
  }
  if (end > start) {
    return parseFloat(json.substring(start, end))
  }
  return 0.0
}

function parseStringFromJson(json: string, key: string): string {
  const searchKey = '"' + key + '":"'
  const match = json.indexOf(searchKey)
  if (match < 0) return ''

  const start = match + searchKey.length
  const end = json.indexOf('"', start)
  if (end > start) {
    return json.substring(start, end)
  }
  return ''
}

function parseBoolFromJson(json: string, key: string): bool {
  const searchKey = '"' + key + '":'
  const match = json.indexOf(searchKey)
  if (match < 0) return false

  const start = match + searchKey.length
  return json.substr(start, 4) === 'true'
}

// ===== Course Calculations =====

function calculateVMG(): f64 {
  // Velocity Made Good to wind
  if (windAngleTrueGround === 0.0 || speedOverGround === 0.0) {
    return 0.0
  }
  return Math.cos(windAngleTrueGround) * speedOverGround
}

function calculateVMC(bearingTrue: f64): f64 {
  // Velocity Made Good to Course
  if (courseOverGroundTrue === 0.0 || speedOverGround === 0.0) {
    return 0.0
  }
  return Math.cos(Math.abs(angleDifference(bearingTrue, courseOverGroundTrue))) * speedOverGround
}

function calculateTimeToGo(distance: f64, vmc: f64): f64 {
  if (vmc <= 0.0 || distance <= 0.0) return 0.0
  return distance / vmc // seconds
}

function checkPassedPerpendicular(vessel: LatLon, dest: LatLon, start: LatLon): bool {
  // Calculate if vessel has passed the perpendicular to destination
  const vx = dest.longitude - vessel.longitude
  const vy = dest.latitude - vessel.latitude
  const vaLen = Math.sqrt(vx * vx + vy * vy)

  const sx = dest.longitude - start.longitude
  const sy = dest.latitude - start.latitude
  const sbLen = Math.sqrt(sx * sx + sy * sy)

  if (vaLen === 0.0 || sbLen === 0.0) return false

  const dotProduct = vx * sx + vy * sy
  const rad = Math.acos(dotProduct / (vaLen * sbLen))
  const deg = toDegrees(rad)

  return deg > 90.0
}

function performCalculations(): void {
  if (!hasVesselPosition || !hasNextPoint || !hasPrevPoint) {
    return
  }

  const vesselLatLon = new LatLon(vesselLat, vesselLon)
  const destLatLon = new LatLon(nextPointLat, nextPointLon)
  const startLatLon = new LatLon(prevPointLat, prevPointLon)

  // Cross-track error (same for both methods)
  const xte = vesselLatLon.crossTrackDistanceTo(startLatLon, destLatLon)
  const vmg = calculateVMG()

  // GreatCircle calculations
  const gcBearingTrackTrue = toRadians(startLatLon.initialBearingTo(destLatLon))
  const gcBearingTrue = toRadians(vesselLatLon.initialBearingTo(destLatLon))
  const gcBearingTrackMagnetic = compassAngle(gcBearingTrackTrue + magneticVariation)
  const gcBearingMagnetic = compassAngle(gcBearingTrue + magneticVariation)
  const gcDistance = vesselLatLon.distanceTo(destLatLon)
  const gcVmc = calculateVMC(gcBearingTrue)
  const gcTtg = calculateTimeToGo(gcDistance, gcVmc)
  const gcPrevDist = vesselLatLon.distanceTo(startLatLon)

  lastGcBearingTrackTrue = gcBearingTrackTrue
  lastGcBearingTrackMagnetic = gcBearingTrackMagnetic
  lastGcXte = xte
  lastGcDistance = gcDistance
  lastGcBearingTrue = gcBearingTrue
  lastGcBearingMagnetic = gcBearingMagnetic
  lastGcVmg = gcVmc
  lastGcTtg = gcTtg
  lastGcPrevDistance = gcPrevDist

  // Rhumbline calculations
  const rlBearingTrackTrue = toRadians(startLatLon.rhumbBearingTo(destLatLon))
  const rlBearingTrue = toRadians(vesselLatLon.rhumbBearingTo(destLatLon))
  const rlBearingTrackMagnetic = compassAngle(rlBearingTrackTrue + magneticVariation)
  const rlBearingMagnetic = compassAngle(rlBearingTrue + magneticVariation)
  const rlDistance = vesselLatLon.rhumbDistanceTo(destLatLon)
  const rlVmc = calculateVMC(rlBearingTrue)
  const rlTtg = calculateTimeToGo(rlDistance, rlVmc)
  const rlPrevDist = vesselLatLon.rhumbDistanceTo(startLatLon)

  lastRlBearingTrackTrue = rlBearingTrackTrue
  lastRlBearingTrackMagnetic = rlBearingTrackMagnetic
  lastRlXte = xte
  lastRlDistance = rlDistance
  lastRlBearingTrue = rlBearingTrue
  lastRlBearingMagnetic = rlBearingMagnetic
  lastRlVmg = rlVmc
  lastRlTtg = rlTtg
  lastRlPrevDistance = rlPrevDist

  hasCalcData = true

  // Emit deltas based on configured method
  emitCourseDeltas()

  // Check arrival circle
  const distance = configCalcMethod === 'Rhumbline' ? rlDistance : gcDistance
  checkArrivalCircle(distance)

  // Emit meta once
  if (!metaSent) {
    emitMetaDeltas()
    metaSent = true
  }
}

// ===== Delta Emission =====

function emitCourseDeltas(): void {
  const isRhumbline = configCalcMethod === 'Rhumbline'
  const calcMethod = isRhumbline ? 'Rhumbline' : 'GreatCircle'

  const bearingTrackTrue = isRhumbline ? lastRlBearingTrackTrue : lastGcBearingTrackTrue
  const bearingTrackMagnetic = isRhumbline ? lastRlBearingTrackMagnetic : lastGcBearingTrackMagnetic
  const xte = isRhumbline ? lastRlXte : lastGcXte
  const distance = isRhumbline ? lastRlDistance : lastGcDistance
  const bearingTrue = isRhumbline ? lastRlBearingTrue : lastGcBearingTrue
  const bearingMagnetic = isRhumbline ? lastRlBearingMagnetic : lastGcBearingMagnetic
  const vmg = isRhumbline ? lastRlVmg : lastGcVmg
  const ttg = isRhumbline ? lastRlTtg : lastGcTtg
  const prevDistance = isRhumbline ? lastRlPrevDistance : lastGcPrevDistance

  const source = new Source('course-provider-wasm', 'plugin')
  const timestamp = getCurrentTimestamp()

  const values: PathValue[] = [
    new PathValue('navigation.course.calcValues.calcMethod', '"' + calcMethod + '"'),
    new PathValue('navigation.course.calcValues.bearingTrackTrue', bearingTrackTrue.toString()),
    new PathValue('navigation.course.calcValues.bearingTrackMagnetic', bearingTrackMagnetic.toString()),
    new PathValue('navigation.course.calcValues.crossTrackError', xte.toString()),
    new PathValue('navigation.course.calcValues.distance', distance.toString()),
    new PathValue('navigation.course.calcValues.bearingTrue', bearingTrue.toString()),
    new PathValue('navigation.course.calcValues.bearingMagnetic', bearingMagnetic.toString()),
    new PathValue('navigation.course.calcValues.velocityMadeGood', vmg.toString()),
    new PathValue('performance.velocityMadeGoodToWaypoint', vmg.toString()),
    new PathValue('navigation.course.calcValues.timeToGo', ttg.toString()),
    new PathValue('navigation.course.calcValues.previousPoint.distance', prevDistance.toString())
  ]

  const update = new Update(source, timestamp, values)
  const delta = new Delta('vessels.self', [update])
  emit(delta)
}

function emitMetaDeltas(): void {
  const calcPath = 'navigation.course.calcValues'
  const source = new Source('course-provider-wasm', 'plugin')
  const timestamp = getCurrentTimestamp()

  // Meta values - using JSON objects as values
  const values: PathValue[] = [
    new PathValue(calcPath + '.calcMethod', '{"description":"Calculation type used (GreatCircle or Rhumbline)."}'),
    new PathValue(calcPath + '.bearingTrackTrue', '{"description":"The bearing of a line between previousPoint and nextPoint, relative to true north.","units":"rad"}'),
    new PathValue(calcPath + '.bearingTrackMagnetic', '{"description":"The bearing of a line between previousPoint and nextPoint, relative to magnetic north.","units":"rad"}'),
    new PathValue(calcPath + '.crossTrackError', '{"description":"The distance from the vessel position to the closest point on the track line.","units":"m"}'),
    new PathValue(calcPath + '.distance', '{"description":"The distance between the vessel position and nextPoint.","units":"m"}'),
    new PathValue(calcPath + '.bearingTrue', '{"description":"The bearing from vessel position to nextPoint, relative to true north.","units":"rad"}'),
    new PathValue(calcPath + '.bearingMagnetic', '{"description":"The bearing from vessel position to nextPoint, relative to magnetic north.","units":"rad"}'),
    new PathValue(calcPath + '.velocityMadeGood', '{"description":"The velocity component of the vessel towards the nextPoint.","units":"m/s"}'),
    new PathValue(calcPath + '.timeToGo', '{"description":"Time in seconds to reach nextPoint.","units":"s"}'),
    new PathValue(calcPath + '.previousPoint.distance', '{"description":"The distance between the vessel position and previousPoint.","units":"m"}')
  ]

  const update = new Update(source, timestamp, values)

  // Need to emit as meta - but SDK doesn't support meta directly
  // For now we emit as regular values - the server should handle this
  const delta = new Delta('vessels.self', [update])
  emit(delta)
}

function checkArrivalCircle(distance: f64): void {
  if (arrivalCircle <= 0.0) return

  const isInCircle = distance <= arrivalCircle

  if (isInCircle && !wasInArrivalCircle) {
    // Entered arrival circle - emit notification
    const message = 'Entered arrival zone: ' + distance.toString() + 'm < ' + arrivalCircle.toString() + 'm'
    emitNotification('navigation.course.arrivalCircleEntered', NotificationState.alert, message)
    wasInArrivalCircle = true
  } else if (!isInCircle && wasInArrivalCircle) {
    // Exited arrival circle - clear notification
    emitNotificationClear('navigation.course.arrivalCircleEntered')
    wasInArrivalCircle = false
  }
}

function emitNotification(path: string, state: NotificationState, message: string): void {
  const notification = new Notification(state, message)
  const source = new Source('course-provider-wasm', 'plugin')
  const timestamp = getCurrentTimestamp()

  const values: PathValue[] = [
    new PathValue('notifications.' + path, notification.toJSON())
  ]

  const update = new Update(source, timestamp, values)
  const delta = new Delta('vessels.self', [update])
  emit(delta)
}

function emitNotificationClear(path: string): void {
  const source = new Source('course-provider-wasm', 'plugin')
  const timestamp = getCurrentTimestamp()

  const values: PathValue[] = [
    new PathValue('notifications.' + path, 'null')
  ]

  const update = new Update(source, timestamp, values)
  const delta = new Delta('vessels.self', [update])
  emit(delta)
}


// ===== Delta Handler =====

export function delta_handler(deltaJson: string): void {
  // Parse incoming delta for navigation data

  // Check for position update
  if (deltaJson.indexOf('"navigation.position"') >= 0 || deltaJson.indexOf('"path":"navigation.position"') >= 0) {
    const lat = parseFloat64FromJson(deltaJson, 'latitude')
    const lon = parseFloat64FromJson(deltaJson, 'longitude')

    if (lat !== 0.0 || lon !== 0.0) {
      vesselLat = lat
      vesselLon = lon
      hasVesselPosition = true

      // Trigger calculation on position update
      if (hasNextPoint && hasPrevPoint) {
        performCalculations()
      }
    }
  }

  // Check for magneticVariation
  if (deltaJson.indexOf('"navigation.magneticVariation"') >= 0) {
    magneticVariation = parseFloat64FromJson(deltaJson, 'value')
  }

  // Check for speedOverGround
  if (deltaJson.indexOf('"navigation.speedOverGround"') >= 0) {
    speedOverGround = parseFloat64FromJson(deltaJson, 'value')
  }

  // Check for courseOverGroundTrue
  if (deltaJson.indexOf('"navigation.courseOverGroundTrue"') >= 0) {
    courseOverGroundTrue = parseFloat64FromJson(deltaJson, 'value')
  }

  // Check for arrivalCircle
  if (deltaJson.indexOf('"navigation.course.arrivalCircle"') >= 0) {
    arrivalCircle = parseFloat64FromJson(deltaJson, 'value')
  }

  // Check for nextPoint - look for the exact path
  // The path format is "path":"navigation.course.nextPoint" with a position object
  if (deltaJson.indexOf('"path":"navigation.course.nextPoint"') >= 0) {
    // Try to extract position from the value
    const lat = parseFloat64FromJson(deltaJson, 'latitude')
    const lon = parseFloat64FromJson(deltaJson, 'longitude')

    if (lat !== 0.0 || lon !== 0.0) {
      nextPointLat = lat
      nextPointLon = lon
      hasNextPoint = true
      debug('nextPoint updated: lat=' + lat.toString() + ' lon=' + lon.toString())
    } else {
      // No valid coordinates - check if this is a null/clear
      // Look for "value":null pattern near navigation.course.nextPoint
      const pathIdx = deltaJson.indexOf('"path":"navigation.course.nextPoint"')
      const checkRange = deltaJson.substring(pathIdx, Math.min(pathIdx + 100, deltaJson.length) as i32)
      if (checkRange.indexOf('"value":null') >= 0) {
        hasNextPoint = false
        hasCalcData = false
        debug('Destination cleared - nextPoint set to null')
      }
    }
  }

  // Check for previousPoint - look for the exact path
  if (deltaJson.indexOf('"path":"navigation.course.previousPoint"') >= 0) {
    // Try to extract position from the value
    const lat = parseFloat64FromJson(deltaJson, 'latitude')
    const lon = parseFloat64FromJson(deltaJson, 'longitude')

    if (lat !== 0.0 || lon !== 0.0) {
      prevPointLat = lat
      prevPointLon = lon
      hasPrevPoint = true
      debug('previousPoint updated: lat=' + lat.toString() + ' lon=' + lon.toString())
    } else {
      // No valid coordinates - check if this is a null/clear
      const pathIdx = deltaJson.indexOf('"path":"navigation.course.previousPoint"')
      const checkRange = deltaJson.substring(pathIdx, Math.min(pathIdx + 100, deltaJson.length) as i32)
      if (checkRange.indexOf('"value":null') >= 0) {
        hasPrevPoint = false
        hasCalcData = false
        debug('Destination cleared - previousPoint set to null')
      }
    }
  }
}

// ===== HTTP Endpoint Handler =====

export function http_get_calcValues(requestJson: string): string {
  if (!hasCalcData) {
    return '{"statusCode":400,"headers":{"Content-Type":"application/json"},"body":"{\\"error\\":\\"No active destination\\"}"}'
  }

  const isRhumbline = configCalcMethod === 'Rhumbline'
  const calcMethod = isRhumbline ? 'Rhumbline' : 'GreatCircle'

  const distance = isRhumbline ? lastRlDistance : lastGcDistance
  const bearingTrue = isRhumbline ? lastRlBearingTrue : lastGcBearingTrue
  const bearingMagnetic = isRhumbline ? lastRlBearingMagnetic : lastGcBearingMagnetic
  const bearingTrackTrue = isRhumbline ? lastRlBearingTrackTrue : lastGcBearingTrackTrue
  const bearingTrackMagnetic = isRhumbline ? lastRlBearingTrackMagnetic : lastGcBearingTrackMagnetic
  const xte = isRhumbline ? lastRlXte : lastGcXte
  const vmg = isRhumbline ? lastRlVmg : lastGcVmg
  const ttg = isRhumbline ? lastRlTtg : lastGcTtg
  const prevDistance = isRhumbline ? lastRlPrevDistance : lastGcPrevDistance

  let body = '{'
  body += '"calcMethod":"' + calcMethod + '",'
  body += '"distance":' + distance.toString() + ','
  body += '"bearingTrue":' + bearingTrue.toString() + ','
  body += '"bearingMagnetic":' + bearingMagnetic.toString() + ','
  body += '"bearingTrackTrue":' + bearingTrackTrue.toString() + ','
  body += '"bearingTrackMagnetic":' + bearingTrackMagnetic.toString() + ','
  body += '"crossTrackError":' + xte.toString() + ','
  body += '"velocityMadeGood":' + vmg.toString() + ','
  body += '"timeToGo":' + ttg.toString() + ','
  body += '"previousPoint":{"distance":' + prevDistance.toString() + '}'
  body += '}'

  // Escape quotes in body for JSON response
  let escapedBody = ''
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i)
    if (c === '"') {
      escapedBody += '\\"'
    } else {
      escapedBody += c
    }
  }

  return '{"statusCode":200,"headers":{"Content-Type":"application/json"},"body":"' + escapedBody + '"}'
}

// ===== Plugin Class =====

class CourseProviderPlugin extends Plugin {
  id(): string {
    return 'course-provider-wasm'
  }

  name(): string {
    return 'Course Data Provider (WASM)'
  }

  start(configJson: string): i32 {
    debug('Course Provider WASM starting...')

    // Parse configuration
    configSoundNotifications = parseBoolFromJson(configJson, 'sound')
    const method = parseStringFromJson(configJson, 'method')
    if (method.length > 0) {
      configCalcMethod = method
    }

    debug('Config: method=' + configCalcMethod + ', sound=' + (configSoundNotifications ? 'true' : 'false'))

    // Initialize from current Signal K state
    initializeFromState()

    setStatus('Running - ' + configCalcMethod)
    return 0
  }

  stop(): i32 {
    debug('Course Provider WASM stopped')
    setStatus('Stopped')

    // Clear arrival notification on stop
    if (wasInArrivalCircle) {
      emitNotificationClear('navigation.course.arrivalCircleEntered')
      wasInArrivalCircle = false
    }

    return 0
  }

  schema(): string {
    return '{"type":"object","properties":{"notifications":{"type":"object","title":"Notifications","description":"Configure the options for generated notifications.","properties":{"sound":{"type":"boolean","title":"Enable sound","default":false}}},"calculations":{"type":"object","title":"Calculations","description":"Configure course calculations options.","properties":{"method":{"type":"string","title":"Calculation method","default":"GreatCircle","enum":["GreatCircle","Rhumbline"]}}}}}'
  }
}

function initializeFromState(): void {
  debug('Initializing from Signal K state...')

  // Get current position
  const posJson = getSelfPath('navigation.position')
  if (posJson !== null && posJson.length > 0) {
    const lat = parseFloat64FromJson(posJson, 'latitude')
    const lon = parseFloat64FromJson(posJson, 'longitude')
    if (lat !== 0.0 || lon !== 0.0) {
      vesselLat = lat
      vesselLon = lon
      hasVesselPosition = true
      debug('Initial position: ' + lat.toString() + ', ' + lon.toString())
    }
  }

  // Get magnetic variation
  const magVarJson = getSelfPath('navigation.magneticVariation')
  if (magVarJson !== null && magVarJson.length > 0) {
    magneticVariation = parseFloat64FromJson(magVarJson, 'value')
  }

  // Get SOG
  const sogJson = getSelfPath('navigation.speedOverGround')
  if (sogJson !== null && sogJson.length > 0) {
    speedOverGround = parseFloat64FromJson(sogJson, 'value')
  }

  // Get COG
  const cogJson = getSelfPath('navigation.courseOverGroundTrue')
  if (cogJson !== null && cogJson.length > 0) {
    courseOverGroundTrue = parseFloat64FromJson(cogJson, 'value')
  }

  // Get arrival circle
  const arrivalJson = getSelfPath('navigation.course.arrivalCircle')
  if (arrivalJson !== null && arrivalJson.length > 0) {
    arrivalCircle = parseFloat64FromJson(arrivalJson, 'value')
  }

  // Get next point
  const nextJson = getSelfPath('navigation.course.nextPoint')
  if (nextJson !== null && nextJson.length > 0 && nextJson.indexOf('"position"') >= 0) {
    const lat = parseFloat64FromJson(nextJson, 'latitude')
    const lon = parseFloat64FromJson(nextJson, 'longitude')
    if (lat !== 0.0 || lon !== 0.0) {
      nextPointLat = lat
      nextPointLon = lon
      hasNextPoint = true
      debug('Next point: ' + lat.toString() + ', ' + lon.toString())
    }
  }

  // Get previous point
  const prevJson = getSelfPath('navigation.course.previousPoint')
  if (prevJson !== null && prevJson.length > 0 && prevJson.indexOf('"position"') >= 0) {
    const lat = parseFloat64FromJson(prevJson, 'latitude')
    const lon = parseFloat64FromJson(prevJson, 'longitude')
    if (lat !== 0.0 || lon !== 0.0) {
      prevPointLat = lat
      prevPointLon = lon
      hasPrevPoint = true
      debug('Previous point: ' + lat.toString() + ', ' + lon.toString())
    }
  }
}

// ===== Plugin Instance & Exports =====

const plugin = new CourseProviderPlugin()

export function plugin_id(): string {
  return plugin.id()
}

export function plugin_name(): string {
  return plugin.name()
}

export function plugin_schema(): string {
  return plugin.schema()
}

export function plugin_start(configPtr: usize, configLen: usize): i32 {
  const len = i32(configLen)
  const configBytes = new Uint8Array(len)
  for (let i: i32 = 0; i < len; i++) {
    configBytes[i] = load<u8>(configPtr + <usize>i)
  }
  const configJson = String.UTF8.decode(configBytes.buffer)
  return plugin.start(configJson)
}

export function plugin_stop(): i32 {
  return plugin.stop()
}

// HTTP endpoints export
export function http_endpoints(): string {
  return '[{"method":"GET","path":"/api/calcValues","handler":"http_get_calcValues"}]'
}
