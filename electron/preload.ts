import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
// on() opakowuje listener w nową funkcję — off() musi zdejmować TEN wrapper,
// inaczej każdy cykl mount/unmount zostawia wiszący listener (przeciek)
const wrappedListeners = new WeakMap<
  (...args: unknown[]) => void,
  (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
>()

contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    const wrapped = (event: Electron.IpcRendererEvent, ...rest: unknown[]) => listener(event, ...rest)
    wrappedListeners.set(listener as (...a: unknown[]) => void, wrapped)
    return ipcRenderer.on(channel, wrapped)
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, listener] = args
    const wrapped = wrappedListeners.get(listener as (...a: unknown[]) => void) ?? listener
    return ipcRenderer.off(channel, wrapped as Parameters<typeof ipcRenderer.off>[1])
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})
