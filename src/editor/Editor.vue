<script setup lang="ts">
import FileSelector from './FileSelector.vue'
import CodeMirror from '../codemirror/CodeMirror.vue'
import Message from '../Message.vue'
import { debounce } from '../utils'
import { computed, inject } from 'vue'
import { Store } from '../store'

const store = inject('store') as Store

// 获取 CodeMirror 编辑器传来的当前选择的虚拟问价你的代码内容
const onChange = debounce((code: string) => {
  // 更新到 store 中的当前文件代码属性上
  store.state.activeFile.code = code
}, 250)

// 计算获取当前选择虚拟文件的文件类型
const activeMode = computed(() => {
  // 根据类型，修改 CodeMirror 编辑器的 mode （即指定语言类型）
  const { filename } = store.state.activeFile
  return filename.endsWith('.vue') || filename.endsWith('.html')
    ? 'htmlmixed'
    : filename.endsWith('.css')
    ? 'css'
    : 'javascript'
})
</script>

<template>
  <!-- 虚拟文件选择 -->
  <FileSelector />
  <div class="editor-container">
    <!-- CodeMirror 的编辑器 -->
    <CodeMirror
      @change="onChange"
      :value="store.state.activeFile.code"
      :mode="activeMode"
    />
    <!-- 错误提示 -->
    <Message :err="store.state.errors[0]" />
  </div>
</template>

<style scoped>
.editor-container {
  height: calc(100% - var(--header-height));
  overflow: hidden;
  position: relative;
}
</style>
