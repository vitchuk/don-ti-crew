import { createApp } from 'vue'
import App from './App.vue'
import { registerSW } from 'virtual:pwa-register'
import './styles/base.css'

void registerSW()
createApp(App).mount('#app')
