<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useLibrary } from '../../stores/library'
import { useSettings } from '../../stores/settings'
import { BUNDLED_CURATED, CURATED_LIST_PAGE, fetchCuratedLists } from '../../services/curatedBooklists'
import { doubanSearchUrl, findMatchingBook, findQuery, yearLabel, type CuratedBook, type CuratedList } from '../../services/booklists'
import { readerPath } from '../../services/readerRoute'
import { openDownload } from '../../services/updater'
import { toast } from '../../services/toast'
import { t } from '../../i18n'

const props = defineProps<{ keyword: string }>()
const library = useLibrary(), settings = useSettings(), route = useRoute(), router = useRouter()
const collection = ref(BUNDLED_CURATED), refreshing = ref(false), adding = ref(false)
const section = ref<HTMLElement>()
const title = (list: CuratedList) => settings.language === 'en' && list.en?.title || list.title
const description = (list: CuratedList) => settings.language === 'en' && list.en?.description || list.description
const lists = computed(() => collection.value.lists.filter(list => !props.keyword.trim() || `${title(list)} ${description(list)} ${list.tags.join(' ')}`.toLocaleLowerCase().includes(props.keyword.trim().toLocaleLowerCase())))
const selected = computed(() => collection.value.lists.find(list => list.id === route.query.recommended))
const owned = (book: CuratedBook) => findMatchingBook(book, library.books)
const ownedCount = (list: CuratedList) => list.books.filter(owned).length
async function refresh(force = false) {
  if (refreshing.value) return
  refreshing.value = true
  try {
    collection.value = await fetchCuratedLists(force)
    if (force) toast(t(collection.value.fromRemote ? 'booklist.listsRefreshed' : 'booklist.listsRefreshFailed', { n: collection.value.lists.length, date: collection.value.updated }), collection.value.fromRemote ? 'success' : 'info')
  } finally { refreshing.value = false }
}
async function openList(list?: CuratedList) {
  await router.push({ path: '/library', query: { view: 'booklists', ...(list ? { recommended: list.id } : {}) } })
}
async function website(url: string) {
  try { await openDownload(url) } catch (e: any) { toast(t('catalog.loadFailed') + ': ' + (e?.message ?? e), 'error') }
}
function find(book: CuratedBook, original = false) {
  const q = original && book.originalTitle ? findQuery(book.originalTitle, book.originalAuthor ?? '') : findQuery(book.title, book.author)
  void router.push({ path: '/catalogs', query: { q } })
}
function read(book: CuratedBook) {
  const match = owned(book)
  const full = match && library.books.find(item => item.id === match.id)
  if (full) void router.push(readerPath(full))
}
async function add(list: CuratedList) {
  if (adding.value) return
  adding.value = true
  try {
    const result = await library.saveEntriesAsBooklist(title(list), list.books)
    toast(t(result.linked || result.wanted ? 'booklist.addedAll' : 'booklist.addedAllNothing', { name: result.name, linked: result.linked, wanted: result.wanted }), 'success', 6000, {
      label: t('booklist.viewInLibrary'), run: () => router.push({ path: '/library', query: { booklist: result.id } }),
    })
  } catch (e: any) { toast(e?.message ?? t('common.unknownError'), 'error', 6000) }
  finally { adding.value = false }
}
onMounted(async () => {
  void refresh()
  if (selected.value) { await nextTick(); section.value?.scrollIntoView({ block: 'start' }) }
})
</script>

<template>
  <section ref="section" class="recommended-booklists" :aria-label="t('booklist.curatedTitle')">
    <template v-if="!selected">
      <header class="recommendation-head"><div><h2>{{ t('booklist.curatedTitle') }}</h2><p>{{ t('booklist.curatedDesc') }}</p></div></header>
      <div class="recommendation-actions">
        <button class="btn" :disabled="refreshing" @click="refresh(true)">{{ t('booklist.updateLists') }}</button>
        <button class="btn" @click="website(CURATED_LIST_PAGE)">{{ t('booklist.suggestList') }}</button>
      </div>
      <div class="curated-grid">
        <button v-for="list in lists" :key="list.id" class="curated-card card" :aria-label="t('booklist.openList', { title: title(list) })" @click="openList(list)">
          <strong>{{ title(list) }}<span aria-hidden="true">›</span></strong>
          <span class="curated-desc">{{ description(list) }}</span>
          <span class="curated-meta">{{ t('booklist.bookCount', { n: list.books.length }) }}<span v-if="ownedCount(list)" class="curated-owned">{{ t('booklist.ownedCount', { n: ownedCount(list) }) }}</span><span v-for="tag in list.tags.slice(0, 2)" :key="tag">{{ tag }}</span></span>
        </button>
      </div>
      <p v-if="!lists.length" class="curated-meta">{{ t('reader.noResults') }}</p>
      <p class="curated-meta">{{ t('booklist.updatedOn', { date: collection.updated }) }}{{ collection.fromRemote ? '' : t('catalog.communityBundled') }}</p>
    </template>
    <template v-else>
      <button class="btn curated-back" @click="openList()">‹ {{ t('booklist.curatedTitle') }}</button>
      <header class="curated-hero"><h2>{{ title(selected) }}</h2><p>{{ description(selected) }}</p>
        <p class="curated-meta">{{ selected.curator }} · {{ t('booklist.bookCount', { n: selected.books.length }) }} · {{ t('booklist.updatedOn', { date: selected.updated }) }}</p>
        <div class="curated-meta">{{ t('booklist.source') }}<button class="btn" @click="website(selected.source.url)">{{ selected.source.name }}</button>{{ selected.source.license }}</div>
        <button class="btn btn-primary curated-add" :disabled="adding" @click="add(selected)">{{ t('booklist.addAll') }}</button>
      </header>
      <ol class="curated-books">
        <li v-for="(book, i) in selected.books" :key="i" class="curated-book card" :class="{ owned: !!owned(book) }">
          <div class="curated-title"><span class="curated-num">{{ i + 1 }}</span><h3>{{ book.title }}<small v-if="book.originalTitle">{{ book.originalTitle }}</small></h3></div>
          <p class="curated-meta">{{ book.author }} {{ yearLabel(book.year, settings.language === 'en' ? 'en' : 'zh') }}</p>
          <p v-if="book.note" class="curated-desc">{{ book.note }}</p>
          <div class="recommendation-actions">
            <template v-if="owned(book)"><span class="curated-owned">{{ t('booklist.inLibrary') }}</span><button class="btn btn-primary" @click="read(book)">{{ t('booklist.open') }}</button></template>
            <template v-else><button class="btn btn-primary" @click="find(book)">{{ t('booklist.find') }}</button><button v-if="book.originalTitle" class="btn" @click="find(book, true)">{{ t('booklist.findOriginal') }}</button></template>
            <button class="btn" :title="t('booklist.doubanTitle')" @click="website(doubanSearchUrl(book.title, book.author))">{{ t('booklist.douban') }}</button>
          </div>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
.recommended-booklists { margin-top: 28px; border-top: 1px solid var(--border); padding-top: 24px; scroll-margin-top: 80px; }
.recommendation-head h2, .curated-hero h2 { font-size: 18px; line-height: 1.5; color: var(--text); }
.recommendation-head p, .curated-hero > p { color: var(--text-2); font-size: 13px; line-height: 1.65; margin: 6px 0 12px; }
.recommendation-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 12px 0; }
.recommended-booklists .btn { min-height: 44px; white-space: normal; }
.curated-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 12px; }
.curated-card { display: flex; flex-direction: column; gap: 8px; padding: 16px; text-align: left; font: inherit; color: var(--text); cursor: pointer; min-width: 0; }
.curated-card strong { display: flex; justify-content: space-between; gap: 12px; font-size: 15px; }
.curated-card strong span { color: var(--text-3); }
.curated-desc { color: var(--text-2); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.curated-meta { display: flex; gap: 6px 10px; align-items: center; flex-wrap: wrap; font-size: 12px; line-height: 1.7; color: var(--text-3); margin: 8px 0; overflow-wrap: anywhere; }
.curated-owned { color: var(--success); font-size: 12px; }
.curated-back { margin-bottom: 16px; }
.curated-add { width: 100%; margin: 12px 0 20px; }
.curated-books { list-style: none; padding: 0; display: grid; gap: 12px; }
.curated-book { padding: 16px; min-width: 0; }
.curated-title { display: flex; gap: 10px; align-items: baseline; }
.curated-title h3 { font-size: 15px; line-height: 1.6; font-weight: 600; overflow-wrap: anywhere; }
.curated-title small { display: block; font-size: 12px; font-weight: 400; color: var(--text-3); }
.curated-num { color: var(--text-3); font-size: 12px; font-variant-numeric: tabular-nums; }
</style>
