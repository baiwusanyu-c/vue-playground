<script setup lang="ts">
import Message from '../Message.vue'
import {
  ref,
  onMounted,
  onUnmounted,
  watchEffect,
  watch,
  WatchStopHandle,
  inject,
  Ref
} from 'vue'
import srcdoc from './srcdoc.html?raw'
import { PreviewProxy } from './PreviewProxy'
import { compileModulesForPreview } from './moduleCompiler'
import { Store } from '../store'

const props = defineProps<{ show: boolean; ssr: boolean }>()

const store = inject('store') as Store
const clearConsole = inject('clear-console') as Ref<boolean>
const container = ref()
const runtimeError = ref()
const runtimeWarning = ref()

let sandbox: HTMLIFrameElement
let proxy: PreviewProxy
let stopUpdateWatcher: WatchStopHandle | undefined

// create sandbox on mount
// 创建 iframe 沙盒元素
onMounted(createSandbox)

// reset sandbox when import map changes
// 监听 import-map.json 代码，变化时能够重置 iframe 沙盒元素
watch(
  () => store.state.files['import-map.json'].code,
  (raw) => {
    try {
      const map = JSON.parse(raw)
      if (!map.imports) {
        store.state.errors = [`import-map.json is missing "imports" field.`]
        return
      }
      createSandbox()
    } catch (e: any) {
      store.state.errors = [e as Error]
      return
    }
  }
)

// reset sandbox when version changes
// 监听版本，变化时能够重置 iframe 沙盒元素
watch(() => store.state.resetFlip, createSandbox)

// 卸载时重置和销毁
onUnmounted(() => {
  proxy.destroy()
  stopUpdateWatcher && stopUpdateWatcher()
})

function createSandbox() {
  if (sandbox) {
    // 重置和销毁
    // clear prev sandbox
    proxy.destroy()
    stopUpdateWatcher && stopUpdateWatcher()
    container.value.removeChild(sandbox)
  }

  sandbox = document.createElement('iframe')
  sandbox.setAttribute(
    'sandbox',
    [
      'allow-forms',
      'allow-modals',
      'allow-pointer-lock',
      'allow-popups',
      'allow-same-origin',
      'allow-scripts',
      'allow-top-navigation-by-user-activation'
    ].join(' ')
  )

  const importMap = store.getImportMap()
  if (!importMap.imports) {
    importMap.imports = {}
  }
  // 设置默认运行时
  if (!importMap.imports.vue) {
    importMap.imports.vue = store.state.vueRuntimeURL
  }
  // 替换依赖图
  const sandboxSrc = srcdoc.replace(
    /<!--IMPORT_MAP-->/,
    JSON.stringify(importMap)
  )
  // 添加沙盒到容器下（srcdoc是srcdoc.html的字符串）
  sandbox.srcdoc = sandboxSrc
  container.value.appendChild(sandbox)

  // new 一个沙盒与上层应用的通信代理（基于post message）
  proxy = new PreviewProxy(sandbox, {
    // 沙盒钩子 -- fetch 进度
    on_fetch_progress: (progress: any) => {
      // pending_imports = progress;
    },

    // 沙盒钩子 -- 错误捕获
    on_error: (event: any) => {
      const msg =
        event.value instanceof Error ? event.value.message : event.value
      if (
        msg.includes('Failed to resolve module specifier') ||
        msg.includes('Error resolving module specifier')
      ) {
        runtimeError.value =
          msg.replace(/\. Relative references must.*$/, '') +
          `.\nTip: edit the "Import Map" tab to specify import paths for dependencies.`
      } else {
        runtimeError.value = event.value
      }
    },

    // 沙盒钩子 -- 注入错误
    on_unhandled_rejection: (event: any) => {
      let error = event.value
      if (typeof error === 'string') {
        error = { message: error }
      }
      runtimeError.value = 'Uncaught (in promise): ' + error.message
    },

    // 沙盒钩子 -- 警告和错误输出
    on_console: (log: any) => {
      if (log.duplicate) {
        return
      }
      if (log.level === 'error') {
        if (log.args[0] instanceof Error) {
          runtimeError.value = log.args[0].message
        } else {
          runtimeError.value = log.args[0]
        }
      } else if (log.level === 'warn') {
        if (log.args[0].toString().includes('[Vue warn]')) {
          runtimeWarning.value = log.args
            .join('')
            .replace(/\[Vue warn\]:/, '')
            .trim()
        }
      }
    },

    // TODO：作用暂时位置
    on_console_group: (action: any) => {
      // group_logs(action.label, false);
    },

    // TODO：作用暂时位置
    on_console_group_end: () => {
      // ungroup_logs();
    },

    // TODO：作用暂时位置
    on_console_group_collapsed: (action: any) => {
      // group_logs(action.label, true);
    }
  })

  // 沙盒载入时
  sandbox.addEventListener('load', () => {
    // 触发 link 钩子，确保沙盒内 a 标签能够点击跳转(不设置 target属性都可以开tab)
    proxy.handle_links()
    // 开启预览监听
    stopUpdateWatcher = watchEffect(updatePreview)
  })
}

async function updatePreview() {
  if (import.meta.env.PROD && clearConsole.value) {
    console.clear()
  }
  runtimeError.value = null
  runtimeWarning.value = null

  let isSSR = props.ssr
  // 检查 vue 版本
  if (store.vueVersion) {
    const [_, minor, patch] = store.vueVersion.split('.')
    if (parseInt(minor, 10) < 2 || parseInt(patch, 10) < 27) {
      alert(
        `The selected version of Vue (${store.vueVersion}) does not support in-browser SSR.` +
          ` Rendering in client mode instead.`
      )
      isSSR = false
    }
  }

  try {
    const mainFile = store.state.mainFile

    // if SSR, generate the SSR bundle and eval it to render the HTML
    // ssr 预览编译渲染
    if (isSSR && mainFile.endsWith('.vue')) {
      // 将源码编译，得到编译后结果
      const ssrModules = compileModulesForPreview(store, true)
      console.log(
        `[@vue/repl] successfully compiled ${ssrModules.length} modules for SSR.`
      )
      // 注入vue的ssr代码
      await proxy.eval([
        `const __modules__ = {};`,
        ...ssrModules,
        `import { renderToString as _renderToString } from 'vue/server-renderer'
         import { createSSRApp as _createApp } from 'vue'
         const AppComponent = __modules__["${mainFile}"].default
         AppComponent.name = 'Repl'
         const app = _createApp(AppComponent)
         app.config.unwrapInjectedRef = true
         app.config.warnHandler = () => {}
         window.__ssr_promise__ = _renderToString(app).then(html => {
           document.body.innerHTML = '<div id="app">' + html + '</div>'
         }).catch(err => {
           console.error("SSR Error", err)
         })
        `
      ])
    }

    // compile code to simulated module system
    // 将源码编译，得到编译后结果
    const modules = compileModulesForPreview(store)
    console.log(
      `[@vue/repl] successfully compiled ${modules.length} module${
        modules.length > 1 ? `s` : ``
      }.`
    )

    // csr 的 vue 注入
    const codeToEval = [
      `window.__modules__ = {}\nwindow.__css__ = ''\n` +
        `if (window.__app__) window.__app__.unmount()\n` +
        (isSSR ? `` : `document.body.innerHTML = '<div id="app"></div>'`),
      ...modules,
      `document.getElementById('__sfc-styles').innerHTML = window.__css__`
    ]

    // if main file is a vue file, mount it.
    if (mainFile.endsWith('.vue')) {
      codeToEval.push(
        `import { ${
          isSSR ? `createSSRApp` : `createApp`
        } as _createApp } from "vue"
        const _mount = () => {
          const AppComponent = __modules__["${mainFile}"].default
          AppComponent.name = 'Repl'
          const app = window.__app__ = _createApp(AppComponent)
          app.config.unwrapInjectedRef = true
          app.config.errorHandler = e => console.error(e)
          app.mount('#app')
        }
        if (window.__ssr_promise__) {
          window.__ssr_promise__.then(_mount)
        } else {
          _mount()
        }`
      )
    }

    // eval code in sandbox
    await proxy.eval(codeToEval)
  } catch (e: any) {
    runtimeError.value = (e as Error).message
  }
}
</script>

<template>
  <div class="iframe-container" v-show="show" ref="container"></div>
  <Message :err="runtimeError" />
  <Message v-if="!runtimeError" :warn="runtimeWarning" />
</template>

<style scoped>
.iframe-container,
.iframe-container :deep(iframe) {
  width: 100%;
  height: 100%;
  border: none;
  background-color: #fff;
}
</style>
