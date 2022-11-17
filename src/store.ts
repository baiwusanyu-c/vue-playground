import { version, reactive, watchEffect } from 'vue'
import * as defaultCompiler from 'vue/compiler-sfc'
import { compileFile } from './transform'
import { utoa, atou } from './utils'
import {
  SFCScriptCompileOptions,
  SFCAsyncStyleCompileOptions,
  SFCTemplateCompileOptions
} from 'vue/compiler-sfc'
import { OutputModes } from './output/types'
// 默认虚拟文件名称
const defaultMainFile = 'App.vue'
// 默认虚拟文件内容
const welcomeCode = `
<script setup>
import { ref } from 'vue'

const msg = ref('Hello World!')
</script>

<template>
  <h1>{{ msg }}</h1>
  <input v-model="msg">
</template>
`.trim()

// 虚拟文件对象
export class File {
  filename: string // 文件名
  code: string // 源码
  hidden: boolean
  compiled = {
    js: '', // js 编译结果
    css: '', // css 编译结果
    ssr: '' // ssr 编译结果
  }

  constructor(filename: string, code = '', hidden = false) {
    this.filename = filename
    this.code = code
    this.hidden = hidden
  }
}

// StoreState 对象
export interface StoreState {
  mainFile: string // 虚拟入口主文件，CodeMirror 将从它为入口开始运行
  files: Record<string, File>  // 虚拟文件集合对象
  activeFile: File // 当前选择的文件
  errors: (string | Error)[] // 错误信息
  vueRuntimeURL: string // vue 的运行时地址
  vueServerRendererURL: string // vue 的 ssr 渲染器地址
  // used to force reset the sandbox
  resetFlip: boolean // 是否重置预览沙盒
}

// sfc 选项
export interface SFCOptions {
  script?: Omit<SFCScriptCompileOptions, 'id'>
  style?: SFCAsyncStyleCompileOptions
  template?: SFCTemplateCompileOptions
}

// Store 对象
export interface Store {
  state: StoreState // StoreState 对象
  options?: SFCOptions  // sfc 选项
  compiler: typeof defaultCompiler // 编译器
  vueVersion?: string // 当前 vue 版本
  init: () => void // 初始化方法
  setActive: (filename: string) => void // 设置当前激活的 虚拟文件
  addFile: (filename: string | File) => void // 增加虚拟文件方法
  deleteFile: (filename: string) => void // 删除虚拟文件方法
  getImportMap: () => any // 获取依赖图
  initialShowOutput: boolean // 是否初始化时输出展示
  initialOutputMode: OutputModes // 初始化展示的 CodeMirror 编辑器 mode （指定语言）
}

export interface StoreOptions {
  serializedState?: string // 序列化的 state 数据
  showOutput?: boolean // 展示输出
  // loose type to allow getting from the URL without inducing a typing error
  outputMode?: OutputModes | string
  defaultVueRuntimeURL?: string // 默认的 vue 的运行时地址
  defaultVueServerRendererURL?: string // 默认的 vue 的 ssr 渲染器地址
}

export class ReplStore implements Store {
  state: StoreState
  compiler = defaultCompiler
  vueVersion?: string
  options?: SFCOptions
  initialShowOutput: boolean
  initialOutputMode: OutputModes

  private defaultVueRuntimeURL: string
  private defaultVueServerRendererURL: string
  private pendingCompiler: Promise<any> | null = null

  constructor({
    serializedState = '',
    defaultVueRuntimeURL = `https://unpkg.com/@vue/runtime-dom@${version}/dist/runtime-dom.esm-browser.js`,
    defaultVueServerRendererURL = `https://unpkg.com/@vue/server-renderer@${version}/dist/server-renderer.esm-browser.js`,
    showOutput = false,
    outputMode = 'preview'
  }: StoreOptions = {}) {
    let files: StoreState['files'] = {}
    // 初始化 file 信息
    // serializedState 从序列化的 state 参数中获取
    // 这里就是从序列化的 url 中获取持久化的虚拟文件信息
    if (serializedState) {
      const saved = JSON.parse(atou(serializedState))
      for (const filename in saved) {
        files[filename] = new File(filename, saved[filename])
      }
    } else {
      // 加载默认虚拟文件信息
      files = {
        [defaultMainFile]: new File(defaultMainFile, welcomeCode)
      }
    }
    // 设置 默认的 vue 的运行时地址
    this.defaultVueRuntimeURL = defaultVueRuntimeURL
    // 设置 默认的 vue 的 ssr 渲染器地址
    this.defaultVueServerRendererURL = defaultVueServerRendererURL
    // 设置 是否初始化时输出展示
    this.initialShowOutput = showOutput
    // 设置 初始化展示的 CodeMirror 编辑器 mode （指定语言）
    this.initialOutputMode = outputMode as OutputModes

    // 设置主文件
    let mainFile = defaultMainFile
    // 如果默认主文件不在 file 集合中，默认取第一个
    if (!files[mainFile]) {
      mainFile = Object.keys(files)[0]
    }
    // 设置 state
    this.state = reactive({
      mainFile,
      files,
      activeFile: files[mainFile],
      errors: [],
      vueRuntimeURL: this.defaultVueRuntimeURL,
      vueServerRendererURL: this.defaultVueServerRendererURL,
      resetFlip: true
    })

    // 初始化依赖图
    this.initImportMap()
  }

  // don't start compiling until the options are set
  init() {
    // 监听编译当前激活虚拟文件
    watchEffect(() => compileFile(this, this.state.activeFile))
    // 遍历虚拟文件 files 集合挨个编译
    for (const file in this.state.files) {
      if (file !== defaultMainFile) {
        compileFile(this, this.state.files[file])
      }
    }
  }

  // 设置当前激活的虚拟文件
  setActive(filename: string) {
    this.state.activeFile = this.state.files[filename]
  }

  // 新增一个虚拟文件
  addFile(fileOrFilename: string | File): void {
    const file =
      typeof fileOrFilename === 'string'
        ? new File(fileOrFilename)
        : fileOrFilename
    this.state.files[file.filename] = file
    if (!file.hidden) this.setActive(file.filename)
  }

  // 删除一个虚拟文件
  deleteFile(filename: string) {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
      if (this.state.activeFile.filename === filename) {
        this.state.activeFile = this.state.files[this.state.mainFile]
      }
      delete this.state.files[filename]
    }
  }

  // 序列化地址栏哈希
  serialize() {
    return '#' + utoa(JSON.stringify(this.getFiles()))
  }

  // 获得虚拟文件集合的源码集合
  getFiles() {
    const exported: Record<string, string> = {}
    for (const filename in this.state.files) {
      exported[filename] = this.state.files[filename].code
    }
    return exported
  }

  /**
   * 设置虚拟化文件
   * @param newFiles 新的虚拟化文件集合
   * @param mainFile
   */
  async setFiles(newFiles: Record<string, string>, mainFile = defaultMainFile) {
    const files: Record<string, File> = {}
    // 当主传入主文件名等于默认主文件名，且新虚拟文件集合中没有主文件
    // 先设置主文件按
    if (mainFile === defaultMainFile && !newFiles[mainFile]) {
      files[mainFile] = new File(mainFile, welcomeCode)
    }
    // 遍历新虚拟文件列表，设置
    for (const filename in newFiles) {
      files[filename] = new File(filename, newFiles[filename])
    }
    for (const file in files) {
      await compileFile(this, files[file])
    }
    // 最后挂在到 ReplStore 上
    this.state.mainFile = mainFile
    this.state.files = files
    // 重新初始化一些必要的方法
    this.initImportMap()
    this.setActive(mainFile)
    this.forceSandboxReset()
  }

  // 重置预览的 sandbox
  private forceSandboxReset() {
    this.state.resetFlip = !this.state.resetFlip
  }

  // 初始化依赖图
  private initImportMap() {
    // import-map.json 是虚拟文件中的，让用户可以添加依赖
    const map = this.state.files['import-map.json']
    // 没有就加载默认依赖 vue 运行时
    if (!map) {
      this.state.files['import-map.json'] = new File(
        'import-map.json',
        JSON.stringify(
          {
            imports: {
              vue: this.defaultVueRuntimeURL
            }
          },
          null,
          2
        )
      )
    } else {
      // 获取用户设置的依赖源码
      // 如果没有 vue 运行时和 vue 的渲染器，则添加它们
      try {
        const json = JSON.parse(map.code)
        if (!json.imports.vue) {
          json.imports.vue = this.defaultVueRuntimeURL
          map.code = JSON.stringify(json, null, 2)
        }
        if (!json.imports['vue/server-renderer']) {
          json.imports['vue/server-renderer'] = this.defaultVueServerRendererURL
          map.code = JSON.stringify(json, null, 2)
        }
      } catch (e) {}
    }
  }

  // 获取虚拟文件的 import-map.json 源码
  getImportMap() {
    try {
      return JSON.parse(this.state.files['import-map.json'].code)
    } catch (e) {
      this.state.errors = [
        `Syntax error in import-map.json: ${(e as Error).message}`
      ]
      return {}
    }
  }

  // 设置虚拟文件的 import-map.json 源码
  setImportMap(map: {
    imports: Record<string, string>
    scopes?: Record<string, Record<string, string>>
  }) {
    this.state.files['import-map.json']!.code = JSON.stringify(map, null, 2)
  }

  // 设置依赖版本
  async setVueVersion(version: string) {
    this.vueVersion = version
    const compilerUrl = `https://unpkg.com/@vue/compiler-sfc@${version}/dist/compiler-sfc.esm-browser.js`
    const runtimeUrl = `https://unpkg.com/@vue/runtime-dom@${version}/dist/runtime-dom.esm-browser.js`
    const ssrUrl = `https://unpkg.com/@vue/server-renderer@${version}/dist/server-renderer.esm-browser.js`
    this.pendingCompiler = import(/* @vite-ignore */ compilerUrl) //编译器
    this.compiler = await this.pendingCompiler //编译器
    this.pendingCompiler = null
    this.state.vueRuntimeURL = runtimeUrl
    this.state.vueServerRendererURL = ssrUrl
    const importMap = this.getImportMap() // 获取用户设置的 import-map.json 源码
    const imports = importMap.imports || (importMap.imports = {})
    imports.vue = runtimeUrl // 设置 vue 运行时
    imports['vue/server-renderer'] = ssrUrl // 设置 vue 渲染器
    this.setImportMap(importMap) // 回设import-map.json 源码
    this.forceSandboxReset()
    console.info(`[@vue/repl] Now using Vue version: ${version}`)
  }

  // 重置依赖版本
  resetVueVersion() {
    this.vueVersion = undefined
    this.compiler = defaultCompiler
    this.state.vueRuntimeURL = this.defaultVueRuntimeURL
    this.state.vueServerRendererURL = this.defaultVueServerRendererURL
    const importMap = this.getImportMap()
    const imports = importMap.imports || (importMap.imports = {})
    imports.vue = this.defaultVueRuntimeURL
    imports['vue/server-renderer'] = this.defaultVueServerRendererURL
    this.setImportMap(importMap)
    this.forceSandboxReset()
    console.info(`[@vue/repl] Now using default Vue version`)
  }
}
