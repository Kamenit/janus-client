import { createApp } from 'vue'
import App from './App.vue'
import adapter from 'webrtc-adapter';
window.adapter = adapter;

const app = createApp(App)
app.mount('#app')