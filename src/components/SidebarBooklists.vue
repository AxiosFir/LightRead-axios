<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibrary } from '../stores/library'
import { requestLibraryAction } from '../services/libraryActions'
import { t } from '../i18n'

const route = useRoute()
const router = useRouter()
const library = useLibrary()
const root = ref<HTMLElement>()
const keyword = ref('')

const activeId = computed(() =>
  route.path === '/library' && typeof route.query.booklist === 'string' ? route.query.booklist : '')
const isAllActive = computed(() => route.path === '/library' && !activeId.value)
const normalizedKeyword = computed(() => keyword.value.trim().toLocaleLowerCase())
const visibleLists = computed(() => {
  const query = normalizedKeyword.value
  const lists = [...library.booklists]
  return query ? lists.filter(item => item.name.toLocaleLowerCase().includes(query)) : lists
})

const bookIds = computed(() =>
  new Set(library.books.filter(book => (book.kind ?? 'book') === 'book').map(book => book.id)))
const allBookCount = computed(() => bookIds.value.size)
const listCounts = computed(() => Object.fromEntries(library.booklists.map(item => [
  item.id,
  new Set((library.booklistBookIds[item.id] ?? []).filter(id => bookIds.value.has(id))).size,
])))

const listCount = (id: string) => listCounts.value[id] ?? 0

function goAllBooks() {
  if (route.path === '/library' && !route.query.booklist) return
  void router.push('/library')
}

function goBooklist(id: string) {
  if (route.path === '/library' && activeId.value === id) return
  void router.push({ path: '/library', query: { booklist: id } })
}

async function openCreate() {
  if (route.path !== '/library') await router.push('/library')
  requestLibraryAction('create-booklist')
}

async function openManage() {
  if (route.path !== '/library') await router.push('/library')
  requestLibraryAction('manage-booklists')
}

watch(activeId, async () => {
  await nextTick()
  const active = root.value?.querySelector<HTMLElement>('.booklist-link.active')
  active?.scrollIntoView({ block: 'nearest' })
}, { immediate: true })

onMounted(() => {
  if (!library.loaded) void library.refresh()
})
</script>

<template>
  <section ref="root" class="sidebar-booklists" :aria-label="t('library.booklists')">
    <div class="booklists-heading">
      <span>{{ t('library.booklists') }}</span>
      <span v-if="library.booklists.length" class="heading-count">{{ library.booklists.length }}</span>
      <button class="booklists-add" type="button" :title="t('library.newBooklist')" :aria-label="t('library.newBooklist')" @click="openCreate">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M11 11V5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6z"/></svg>
      </button>
    </div>

    <label v-if="library.booklists.length" class="booklists-search">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input v-model="keyword" type="search" :placeholder="t('library.searchBooklists')" :aria-label="t('library.searchBooklists')" />
    </label>

    <div class="booklists-scroll">
      <button class="booklist-link all-books" :class="{ active: isAllActive }" type="button" :aria-current="isAllActive ? 'page' : undefined" @click="goAllBooks">
        <svg class="booklist-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/></svg>
        <span class="booklist-name">{{ t('library.allBooks') }}</span>
        <span class="booklist-count">{{ allBookCount }}</span>
      </button>

      <div v-if="library.booklists.length" class="booklists-label">{{ t('library.booklists') }}</div>
      <button
        v-for="item in visibleLists"
        :key="item.id"
        class="booklist-link"
        :class="{ active: activeId === item.id }"
        type="button"
        :title="item.name"
        :aria-current="activeId === item.id ? 'page' : undefined"
        @click="goBooklist(item.id)"
      >
        <svg class="booklist-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4a2 2 0 0 1 2-2h9a3 3 0 0 1 3 3v15a1 1 0 0 1-1.45.9L12 18.12 6.45 20.9A1 1 0 0 1 5 20V4z"/></svg>
        <span class="booklist-name">{{ item.name }}</span>
        <span class="booklist-count">{{ listCount(item.id) }}</span>
      </button>

      <p v-if="library.booklists.length && !visibleLists.length" class="booklists-empty">{{ t('library.noMatchingBooklists') }}</p>
      <p v-if="!library.booklists.length" class="booklists-empty">{{ t('library.noBooklists') }}</p>
    </div>

    <div class="booklists-footer">
      <button type="button" @click="openManage">{{ t('library.manageBooklists') }}</button>
      <button type="button" class="new-list" @click="openCreate">{{ t('library.newBooklist') }}</button>
    </div>
  </section>
</template>

<style scoped>
.sidebar-booklists {
  flex: 1;
  min-height: 0;
  margin-top: 10px;
  padding-top: 14px;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}
.booklists-heading {
  height: 30px;
  padding: 0 7px;
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text);
  font-size: 13px;
  font-weight: 650;
}
.heading-count {
  color: var(--text-3);
  font-size: 11px;
  font-weight: 500;
}
.booklists-add {
  margin-left: auto;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--text-2);
  display: grid;
  place-items: center;
}
.booklists-add:hover {
  color: var(--brand);
  border-color: color-mix(in srgb, var(--brand) 42%, var(--border));
  background: var(--brand-light);
}
.booklists-search {
  height: 35px;
  margin: 8px 4px 6px;
  padding: 0 9px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: 7px;
  flex: none;
}
.booklists-search:focus-within {
  border-color: color-mix(in srgb, var(--brand) 55%, var(--border));
  box-shadow: var(--ring);
}
.booklists-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.booklists-search input::placeholder { color: var(--text-3); }
.booklists-search input::-webkit-search-cancel-button { display: none; }
.booklists-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 3px 4px 8px;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--text-3) 45%, transparent) transparent;
  overscroll-behavior: contain;
}
.booklists-scroll::-webkit-scrollbar { width: 6px; }
.booklists-scroll::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: color-mix(in srgb, var(--text-3) 42%, transparent);
}
.booklist-link {
  width: 100%;
  min-height: 38px;
  padding: 0 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 8px;
  font: inherit;
  font-size: 13px;
  text-align: left;
}
.booklist-link + .booklist-link { margin-top: 2px; }
.booklist-link:hover { background: var(--surface-2); color: var(--text); }
.booklist-link:focus-visible { outline: none; box-shadow: var(--ring); }
.all-books {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--card);
}
.all-books.active { background: var(--brand-light); }
.booklist-link.active {
  color: var(--brand);
  background: var(--brand-light);
  font-weight: 600;
  box-shadow: inset 3px 0 0 var(--brand);
}
.booklist-icon {
  width: 16px;
  height: 16px;
  flex: none;
  color: var(--text-3);
}
.booklist-link.active .booklist-icon { color: var(--brand); }
.booklist-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.booklist-count {
  flex: none;
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 550;
  text-align: center;
  font-variant-numeric: tabular-nums;
}
.booklist-link.active .booklist-count {
  background: color-mix(in srgb, var(--brand) 13%, transparent);
  color: var(--brand);
}
.booklists-label {
  margin: 10px 8px 5px;
  color: var(--text-3);
  font-size: 10.5px;
  font-weight: 600;
}
.booklists-empty {
  margin: 8px 9px;
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.5;
}
.booklists-footer {
  flex: none;
  padding: 9px 4px 0;
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 6px;
}
.booklists-footer button {
  height: 31px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-3);
  font: inherit;
  font-size: 11.5px;
}
.booklists-footer button:hover { background: var(--surface-2); color: var(--text); }
.booklists-footer .new-list {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--text-2);
  font-weight: 550;
}

@media (max-width: 1023px) {
  .sidebar-booklists { display: none; }
}
</style>
