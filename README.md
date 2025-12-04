# Course Provider Plugin (WASM)

**Signal K server WASM plugin that provides Course data calculations.**

This is a showcase WASM plugin demonstrating:
- **Delta subscriptions** - Reacting to real-time Signal K data changes
- **Geodesy calculations** - Great Circle and Rhumb Line navigation math
- **HTTP endpoints** - Custom REST API for course data
- **Delta emission** - Publishing calculated values back to Signal K

_Requires Signal K Server version 2.19.0+wasm or later with WASM plugin support._

---

## Features

This plugin computes navigation course data and populates the following paths under `navigation.course.calcValues`:

| Path | Description |
|------|-------------|
| `calcMethod` | Calculation type used (GreatCircle or Rhumbline) |
| `bearingTrackTrue` | Bearing of track line relative to true north (rad) |
| `bearingTrackMagnetic` | Bearing of track line relative to magnetic north (rad) |
| `crossTrackError` | Distance from vessel to closest point on track (m) |
| `previousPoint.distance` | Distance to previous waypoint (m) |
| `distance` | Distance to next waypoint (m) |
| `bearingTrue` | Bearing to next waypoint, true north (rad) |
| `bearingMagnetic` | Bearing to next waypoint, magnetic north (rad) |
| `velocityMadeGood` | Velocity component towards waypoint (m/s) |
| `timeToGo` | Time to reach next waypoint (s) |
| `estimatedTimeOfArrival` | ETA timestamp |

Additionally:
- `performance.velocityMadeGoodToWaypoint` - VMG to current waypoint

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Signal K Server                          │
│                                                             │
│  ┌─────────────┐    delta events    ┌──────────────────┐   │
│  │  Course API │ ────────────────►  │  course-provider │   │
│  │  (courseApi)│                    │     (WASM)       │   │
│  └─────────────┘                    │                  │   │
│                                     │  ┌────────────┐  │   │
│  ┌─────────────┐                    │  │ Geodesy    │  │   │
│  │    GPS      │ ────────────────►  │  │ Calc       │  │   │
│  │  (position) │    delta events    │  └────────────┘  │   │
│  └─────────────┘                    │        │         │   │
│                                     │        ▼         │   │
│  ┌─────────────┐   calcValues delta │  ┌────────────┐  │   │
│  │ Data Model  │ ◄───────────────── │  │ Emit Delta │  │   │
│  │             │                    │  └────────────┘  │   │
│  └─────────────┘                    └──────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Delta Subscription

The plugin exports a `delta_handler()` function that receives all Signal K deltas:

```typescript
export function delta_handler(deltaJson: string): void {
  // React to navigation.position updates
  if (deltaJson.indexOf('"path":"navigation.position"') >= 0) {
    // Extract and store position
    // Trigger recalculation
  }

  // React to course destination changes
  if (deltaJson.indexOf('"path":"navigation.course.nextPoint"') >= 0) {
    // Extract destination coordinates
    // Handle null for route clearing
  }
}
```

This demonstrates how WASM plugins can subscribe to real-time data without polling.

## Notifications

The plugin raises the following notifications:

- **`notifications.navigation.course.arrivalCircleEntered`**: Alert when vessel enters the arrival circle defined by `navigation.course.nextPoint.arrivalCircle`

## HTTP API

The plugin exposes an HTTP endpoint:

```bash
GET /plugins/course-provider-wasm/api/calcValues
```

Returns the current calculated course values:

```json
{
  "calcMethod": "GreatCircle",
  "distance": 15420.5,
  "bearingTrue": 1.234,
  "bearingMagnetic": 1.056,
  "crossTrackError": 25.3,
  "velocityMadeGood": 5.2,
  "timeToGo": 2965,
  "previousPoint": {
    "distance": 8230.1
  }
}
```

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| **Enable sound** | Enable sound flag for notifications | false |
| **Calculation method** | GreatCircle or Rhumbline | GreatCircle |

## Building

```bash
# Install dependencies
npm install

# Build WASM plugin
npm run build
```

The compiled plugin will be at `build/plugin.wasm` (~28 KB).

## Installation

### From npm (when published)

```bash
cd ~/.signalk
npm install @signalk/course-provider-wasm
```

### Manual Installation

1. Build the plugin (see above)
2. Copy the entire plugin directory to your Signal K plugins folder:
   ```bash
   cp -r course-provider-plugin ~/.signalk/node_modules/@signalk/course-provider-wasm
   ```
3. Restart Signal K Server
4. Enable the plugin in Server -> Plugin Config

## Required Signal K Paths

The plugin subscribes to these paths via delta events:

| Path | Purpose |
|------|---------|
| `navigation.position` | Vessel position (required) |
| `navigation.course.nextPoint` | Destination waypoint (required) |
| `navigation.course.previousPoint` | Origin waypoint (required) |
| `navigation.magneticVariation` | For magnetic bearing calculations |
| `navigation.speedOverGround` | For VMG calculations |
| `navigation.courseOverGroundTrue` | For VMC calculations |
| `navigation.course.arrivalCircle` | For arrival notification |

## Testing with Freeboard-SK

1. Enable the plugin in Signal K Admin
2. Open Freeboard-SK
3. Right-click on map → "Navigate To" or activate a route
4. Watch the Data Browser for `navigation.course.calcValues.*` paths updating
5. Clear destination → Plugin detects null and stops calculations

## Project Structure

```
course-provider-plugin/
├── assembly/
│   ├── index.ts        # Main plugin code with delta_handler
│   └── geodesy.ts      # Great Circle / Rhumb Line calculations
├── build/
│   └── plugin.wasm     # Compiled WASM binary
├── package.json        # npm manifest with wasmCapabilities
├── asconfig.json       # AssemblyScript compiler config
└── README.md
```

## Key WASM Plugin Exports

| Export | Purpose |
|--------|---------|
| `plugin_id()` | Returns plugin identifier |
| `plugin_name()` | Returns display name |
| `plugin_schema()` | Returns JSON Schema for config |
| `plugin_start(config)` | Initialize plugin with config |
| `plugin_stop()` | Clean shutdown |
| `delta_handler(json)` | **Receive Signal K deltas** |
| `http_get_calcValues(req)` | HTTP endpoint handler |
| `http_endpoints()` | Register HTTP routes |

## Migration from Node.js Version

This WASM version is functionally equivalent to the Node.js `@signalk/course-provider` plugin.

| Aspect | Node.js | WASM |
|--------|---------|------|
| Package | `@signalk/course-provider` | `@signalk/course-provider-wasm` |
| Build | None (interpreted) | `npm run build` (compiled) |
| Runtime | V8 JavaScript | WebAssembly sandbox |
| Size | ~50 KB + dependencies | ~28 KB standalone |
| Geodesy | npm `geodesy` package | Built-in AssemblyScript port |

## Dependencies

**Build-time only:**
- `assemblyscript` - Compiler
- `signalk-assemblyscript-plugin-sdk` - Signal K SDK for WASM

**Runtime:**
- None! The compiled WASM is fully self-contained.

## License

Apache-2.0

## See Also

- [Signal K WASM Plugin Development Guide](https://github.com/SignalK/signalk-server/blob/master/wasm/WASM_PLUGIN_DEV_GUIDE.md)
- [signalk-assemblyscript-plugin-sdk](https://github.com/SignalK/signalk-assemblyscript-plugin-sdk)
- [Signal K Server](https://github.com/SignalK/signalk-server)
