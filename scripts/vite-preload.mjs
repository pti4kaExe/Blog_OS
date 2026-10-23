/**
 * Обход ограничения песочницы при работе Vite на Windows.
 *
 * Vite один раз вызывает `child_process.exec("net use")`, чтобы найти сетевые
 * диски (node_modules/vite/dist/node/chunks/node.js → optimizeSafeRealPathSync).
 * В ограниченной среде spawn с перехватом вывода запрещён (EPERM), и Vite падает
 * с «Build failed with error: spawn EPERM» — к самому проекту это отношения
 * не имеет.
 *
 * Подменяем только exec/execFile: им нужен перехват вывода, а результат здесь
 * неважен — сетевых дисков нет, Vite переходит на обычный realpath.
 * `spawn` не трогаем: он нужен другим инструментам, и с наследованием вывода
 * работает штатно.
 */
import cp from 'node:child_process'

const makeChild = () => {
  const child = {
    pid: 0,
    stdout: { on() {}, pipe() {}, setEncoding() {} },
    stderr: { on() {}, pipe() {}, setEncoding() {} },
    stdin: { end() {}, write() {}, on() {} },
    on() {
      return child
    },
    once() {
      return child
    },
    off() {
      return child
    },
    kill() {},
  }
  return child
}

const stub = (commandOrFile, options, callback) => {
  const cb = typeof options === 'function' ? options : callback
  if (typeof cb === 'function') process.nextTick(() => cb(null, '', ''))
  return makeChild()
}

cp.exec = stub
cp.execFile = stub
