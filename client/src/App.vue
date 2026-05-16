<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRoute } from 'vue-router'
import { watch } from 'vue'

const auth = useAuthStore()
const route = useRoute()

// Check for stored token on mount
auth.checkStoredToken()
</script>

<template>
  <router-view />
</template>
