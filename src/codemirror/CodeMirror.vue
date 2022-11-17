<template>
  <div class="editor" ref="el"></div>
</template>

<script setup lang="ts">
// 基于 CodeMirror（https://github.com/codemirror/CodeMirror.git ）封装的编辑器组件
import {ref, onMounted, watchEffect, inject} from 'vue'
import {debounce} from '../utils'
import CodeMirror from './codemirror'

export interface Props {
  mode?: string
  value?: string
  readonly?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  mode: 'htmlmixed',
  value: '',
  readonly: false
})

const emit = defineEmits<(e: 'change', value: string) => void>()

const el = ref()
const needAutoResize = inject('autoresize')

onMounted(() => {
  const addonOptions = {
    autoCloseBrackets: true,// 输入时自动关闭括号和引号
    autoCloseTags: true, // 自定闭合标签
    foldGutter: true, // 配合 gutters 折叠代码
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']
  }

  // 通过 CodeMirror 创建编辑器
  const editor = CodeMirror(
      el.value!, // 编辑器挂载的 dom
      {
        value: '', // 代码内容
        mode: props.mode, // 代码语言
        readOnly: props.readonly, // 是否只读
        tabSize: 2,
        lineWrapping: true, // 自动换行或滚动条
        lineNumbers: true,// 行号
        ...addonOptions
      })

  // 触发 change，拿到 editor 内容(就是编辑器内的代码)
  editor.on('change', () => {
    emit('change', editor.getValue())
  })

  // props 的同样是编辑器内代码
  // 编辑时，将内容传入给 editor
  // 在 vue-repl 中，用于 vue 组件编译结果展示
  watchEffect(() => {
    const cur = editor.getValue()
    if (props.value !== cur) {
      editor.setValue(props.value)
    }
  })

  // 监听设置 editor 的 mode
  // 其实就是指定 CodeMirror 的语言类型，
  // vue 的 sfc 使用的是 htmlmixed
  watchEffect(() => {
    editor.setOption('mode', props.mode)
  })

  setTimeout(() => {
    editor.refresh()
  }, 50)

  // 刷新 editor 尺寸
  if (needAutoResize) {
    window.addEventListener(
      'resize',
      debounce(() => {
        editor.refresh()
      })
    )
  }
})
</script>

<style>
.editor {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
}

.CodeMirror {
  font-family: var(--font-code);
  line-height: 1.5;
  height: 100%;
}
</style>
