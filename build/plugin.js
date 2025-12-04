async function instantiate(module, imports = {}) {
  const adaptedImports = {
    env: Object.assign(Object.create(globalThis), imports.env || {}, {
      sk_handle_message(deltaPtr, deltaLen) {
        // ~lib/signalk-assemblyscript-plugin-sdk/assembly/api/sk_handle_message_ffi(usize, usize) => void
        deltaPtr = deltaPtr >>> 0;
        deltaLen = deltaLen >>> 0;
        sk_handle_message(deltaPtr, deltaLen);
      },
      sk_debug(msgPtr, msgLen) {
        // ~lib/signalk-assemblyscript-plugin-sdk/assembly/api/sk_debug_ffi(usize, usize) => void
        msgPtr = msgPtr >>> 0;
        msgLen = msgLen >>> 0;
        sk_debug(msgPtr, msgLen);
      },
      sk_get_self_path(pathPtr, pathLen, bufPtr, bufLen) {
        // ~lib/signalk-assemblyscript-plugin-sdk/assembly/api/sk_get_self_path_ffi(usize, usize, usize, usize) => i32
        pathPtr = pathPtr >>> 0;
        pathLen = pathLen >>> 0;
        bufPtr = bufPtr >>> 0;
        bufLen = bufLen >>> 0;
        return sk_get_self_path(pathPtr, pathLen, bufPtr, bufLen);
      },
      sk_set_status(msgPtr, msgLen) {
        // ~lib/signalk-assemblyscript-plugin-sdk/assembly/api/sk_set_status_ffi(usize, usize) => void
        msgPtr = msgPtr >>> 0;
        msgLen = msgLen >>> 0;
        sk_set_status(msgPtr, msgLen);
      },
    }),
  };
  const { exports } = await WebAssembly.instantiate(module, adaptedImports);
  const memory = exports.memory || imports.env.memory;
  const adaptedExports = Object.setPrototypeOf({
    delta_handler(deltaJson) {
      // assembly/index/delta_handler(~lib/string/String) => void
      deltaJson = __lowerString(deltaJson) || __notnull();
      exports.delta_handler(deltaJson);
    },
    http_get_calcValues(requestJson) {
      // assembly/index/http_get_calcValues(~lib/string/String) => ~lib/string/String
      requestJson = __lowerString(requestJson) || __notnull();
      return __liftString(exports.http_get_calcValues(requestJson) >>> 0);
    },
    plugin_id() {
      // assembly/index/plugin_id() => ~lib/string/String
      return __liftString(exports.plugin_id() >>> 0);
    },
    plugin_name() {
      // assembly/index/plugin_name() => ~lib/string/String
      return __liftString(exports.plugin_name() >>> 0);
    },
    plugin_schema() {
      // assembly/index/plugin_schema() => ~lib/string/String
      return __liftString(exports.plugin_schema() >>> 0);
    },
    http_endpoints() {
      // assembly/index/http_endpoints() => ~lib/string/String
      return __liftString(exports.http_endpoints() >>> 0);
    },
  }, exports);
  function __liftString(pointer) {
    if (!pointer) return null;
    const
      end = pointer + new Uint32Array(memory.buffer)[pointer - 4 >>> 2] >>> 1,
      memoryU16 = new Uint16Array(memory.buffer);
    let
      start = pointer >>> 1,
      string = "";
    while (end - start > 1024) string += String.fromCharCode(...memoryU16.subarray(start, start += 1024));
    return string + String.fromCharCode(...memoryU16.subarray(start, end));
  }
  function __lowerString(value) {
    if (value == null) return 0;
    const
      length = value.length,
      pointer = exports.__new(length << 1, 2) >>> 0,
      memoryU16 = new Uint16Array(memory.buffer);
    for (let i = 0; i < length; ++i) memoryU16[(pointer >>> 1) + i] = value.charCodeAt(i);
    return pointer;
  }
  function __notnull() {
    throw TypeError("value must not be null");
  }
  return adaptedExports;
}
export const {
  memory,
  __new,
  __pin,
  __unpin,
  __collect,
  __rtti_base,
  delta_handler,
  http_get_calcValues,
  plugin_id,
  plugin_name,
  plugin_schema,
  plugin_start,
  plugin_stop,
  http_endpoints,
} = await (async url => instantiate(
  await (async () => {
    const isNodeOrBun = typeof process != "undefined" && process.versions != null && (process.versions.node != null || process.versions.bun != null);
    if (isNodeOrBun) { return globalThis.WebAssembly.compile(await (await import("node:fs/promises")).readFile(url)); }
    else { return await globalThis.WebAssembly.compileStreaming(globalThis.fetch(url)); }
  })(), {
  }
))(new URL("plugin.wasm", import.meta.url));
