/**
 * Geodesy calculations for spherical earth model
 * Ported from latlon-spherical.js by Chris Veness
 * https://www.movable-type.co.uk/scripts/latlong.html
 *
 * All calculations use radians internally
 */

// Earth radius in meters
const EARTH_RADIUS: f64 = 6371000.0

/**
 * Convert degrees to radians
 */
export function toRadians(degrees: f64): f64 {
  return degrees * Math.PI / 180.0
}

/**
 * Convert radians to degrees
 */
export function toDegrees(radians: f64): f64 {
  return radians * 180.0 / Math.PI
}

/**
 * Normalize angle to 0-2π range
 */
export function normalizeAngle(angle: f64): f64 {
  const twoPi = Math.PI * 2.0
  if (angle < 0) return angle + twoPi
  if (angle >= twoPi) return angle - twoPi
  return angle
}

/**
 * Normalize angle to compass bearing (0-2π)
 */
export function compassAngle(angle: f64): f64 {
  return normalizeAngle(angle)
}

/**
 * Difference between two angles (in radians)
 * Returns negative for port, positive for starboard
 */
export function angleDifference(heading: f64, bearing: f64): f64 {
  const d = (Math.PI * 2.0) - bearing
  const hd = heading + d
  const a = normalizeAngle(hd)
  return a < Math.PI ? -a : (Math.PI * 2.0) - a
}

/**
 * LatLon class for spherical earth calculations
 */
export class LatLon {
  latitude: f64
  longitude: f64

  constructor(lat: f64, lon: f64) {
    this.latitude = lat
    this.longitude = lon
  }

  /**
   * Distance to another point using Haversine formula
   * @returns distance in meters
   */
  distanceTo(point: LatLon): f64 {
    const lat1 = toRadians(this.latitude)
    const lat2 = toRadians(point.latitude)
    const deltaLat = toRadians(point.latitude - this.latitude)
    const deltaLon = toRadians(point.longitude - this.longitude)

    const a = Math.sin(deltaLat / 2.0) * Math.sin(deltaLat / 2.0) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2.0) * Math.sin(deltaLon / 2.0)
    const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a))

    return EARTH_RADIUS * c
  }

  /**
   * Initial bearing to another point (great circle)
   * @returns bearing in degrees (0-360)
   */
  initialBearingTo(point: LatLon): f64 {
    const lat1 = toRadians(this.latitude)
    const lat2 = toRadians(point.latitude)
    const deltaLon = toRadians(point.longitude - this.longitude)

    const x = Math.cos(lat1) * Math.sin(lat2) -
              Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon)
    const y = Math.sin(deltaLon) * Math.cos(lat2)

    const theta = Math.atan2(y, x)
    return (toDegrees(theta) + 360.0) % 360.0
  }

  /**
   * Cross-track distance to a path defined by start and end points
   * Negative = left of path, Positive = right of path
   * @returns distance in meters
   */
  crossTrackDistanceTo(pathStart: LatLon, pathEnd: LatLon): f64 {
    const delta13 = pathStart.distanceTo(this) / EARTH_RADIUS
    const theta13 = toRadians(pathStart.initialBearingTo(this))
    const theta12 = toRadians(pathStart.initialBearingTo(pathEnd))

    const dXt = Math.asin(Math.sin(delta13) * Math.sin(theta13 - theta12))
    return dXt * EARTH_RADIUS
  }

  /**
   * Rhumb line distance to another point
   * @returns distance in meters
   */
  rhumbDistanceTo(point: LatLon): f64 {
    const lat1 = toRadians(this.latitude)
    const lat2 = toRadians(point.latitude)
    let deltaLon = toRadians(point.longitude - this.longitude)
    const deltaLat = lat2 - lat1

    // Handle crossing antimeridian
    if (Math.abs(deltaLon) > Math.PI) {
      deltaLon = deltaLon > 0 ? -(2.0 * Math.PI - deltaLon) : (2.0 * Math.PI + deltaLon)
    }

    // Stretch factor for latitude
    const deltaPsi = Math.log(Math.tan(lat2 / 2.0 + Math.PI / 4.0) /
                              Math.tan(lat1 / 2.0 + Math.PI / 4.0))

    // E-W course becomes ill-conditioned with 0/0
    const q = Math.abs(deltaPsi) > 1e-12 ? deltaLat / deltaPsi : Math.cos(lat1)

    const delta = Math.sqrt(deltaLat * deltaLat + q * q * deltaLon * deltaLon)
    return delta * EARTH_RADIUS
  }

  /**
   * Rhumb line bearing to another point
   * @returns bearing in degrees (0-360)
   */
  rhumbBearingTo(point: LatLon): f64 {
    const lat1 = toRadians(this.latitude)
    const lat2 = toRadians(point.latitude)
    let deltaLon = toRadians(point.longitude - this.longitude)

    // Handle crossing antimeridian
    if (Math.abs(deltaLon) > Math.PI) {
      deltaLon = deltaLon > 0 ? -(2.0 * Math.PI - deltaLon) : (2.0 * Math.PI + deltaLon)
    }

    const deltaPsi = Math.log(Math.tan(lat2 / 2.0 + Math.PI / 4.0) /
                              Math.tan(lat1 / 2.0 + Math.PI / 4.0))

    const theta = Math.atan2(deltaLon, deltaPsi)
    return (toDegrees(theta) + 360.0) % 360.0
  }
}
