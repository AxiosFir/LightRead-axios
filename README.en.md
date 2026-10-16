<div align="center">

<img src="public/favicon.svg" width="88" alt="LightRead logo" />

# LightRead

**An open-source, local-first ebook and research paper reader.**

[中文](README.md) · English

[Download the latest release](https://github.com/yzfly/LightRead/releases/latest) · [Report an issue](https://github.com/yzfly/LightRead/issues)

<img src="docs/screenshots/library.png" width="880" alt="LightRead local library" />

</div>

LightRead keeps your books, reading progress, and annotations on your device by default. Local reading needs neither an account nor an internet connection. Desktop builds are available for macOS, Windows, and Linux; Android support is experimental.

## Features

- **Read multiple formats:** EPUB, MOBI, AZW/AZW3, FB2, CBZ/CBR, DjVu, PDF, TXT, HTML, and Markdown. KFX and DRM-protected files are not supported.
- **Organize your library:** import local files, drag and drop books, add tags, manage reading progress, and keep bookmarks and annotations.
- **Read PDFs in their original layout:** choose MuPDF or PDFium rendering, continuous scrolling, single-page or facing-page views, and fit-to-width or fit-to-height zoom.
- **Listen to books:** use system speech, optional online voices, or an optional downloadable offline speech model on desktop.
- **Find books and papers:** browse or search sources including Project Gutenberg, Internet Archive, arXiv, and OPDS/Calibre catalogs. Availability and access conditions depend on each source.
- **Move your data:** import/export open `.okf.zip` library packages, choose a custom library location, or use optional WebDAV backup.
- **Optional paper assistance:** translate selected text or paper pages, use a local agent interface, and keep your own answers alongside AI-generated paper analysis.

## Install

Download installers from [GitHub Releases](https://github.com/yzfly/LightRead/releases/latest). Expand **Assets** and choose the file for your system; `x.y.z` represents the version number.

| Platform | Installer |
| --- | --- |
| macOS, Apple Silicon | `LightRead_x.y.z_aarch64.dmg` |
| macOS, Intel | `LightRead_x.y.z_x64.dmg` |
| Windows 10/11, 64-bit | `LightRead_x.y.z_x64-setup.exe` |
| Debian/Ubuntu, 64-bit | `LightRead_x.y.z_amd64.deb` |
| Fedora/RHEL, 64-bit | `LightRead-x.y.z-1.x86_64.rpm` |
| Other Linux distributions, 64-bit | `LightRead_x.y.z_amd64.AppImage` |
| Android, arm64, experimental | `LightRead_vx.y.z_android_arm64.apk` |

On macOS, open the DMG and drag LightRead into Applications. If macOS blocks an unverified developer, first confirm that the file came from this repository, then use the system's **Open** or **Open Anyway** option. On Windows, run the installer.

On Debian/Ubuntu, install a downloaded package with `sudo apt install ./LightRead_x.y.z_amd64.deb`. For an AppImage, grant execute permission before opening it. Linux builds depend on compatible system libraries; an AppImage does not guarantee compatibility with every distribution.

Android is an experimental arm64 build. Historical builds used different signing keys, so an existing installation may reject an update. Do not uninstall or clear app data before exporting and verifying a backup outside the app's private storage. See the [Android migration instructions in the Chinese README](README.md#android实验性).

## First steps

1. Open the library and import a supported book, or drag a file into the window.
2. Open the book to read, adjust the reading theme and typography, and add bookmarks or annotations.
3. Import a PDF into the separate paper library to use paper-reading features.
4. Use **Settings → Data** to choose a library location, export a library package, or configure WebDAV backup.

Desktop builds can also open supported files through the operating system's **Open With** menu. You can use ordinary reading features without installing any agent or command-line tools.

## Research paper workflow

<img src="docs/screenshots/pdf-spread.png" width="880" alt="PDF paper in a facing-page view" />

The paper workspace combines original-layout PDF viewing, text selection, highlights, notes, translation, and optional agent conversations. It can prepare the paper's text, notes, current page, and selection as context for an agent.

The desktop agent interface uses Pi Agent by default, with Codex and Claude Code as optional engines. Install and configure your chosen engine separately. Agent credentials remain managed by the engine itself. These agents run locally but may use remote model providers and retain their own tools, network access, and approval behavior; they are not an isolated sandbox.

The paper-question workflow preserves three separate versions: the initial AI answer, your editable answer, and a subsequent AI answer. Your saved interpretation is not overwritten by generated text.

Optional BabelDOC integration can produce translated or bilingual PDFs while preserving layout. It requires an additional tool/model download and a configured model service. Translation and AI features can incur provider fees and send selected document content to the chosen service. They are not required for local reading.

Scanned PDFs without a text layer can be displayed, but text selection, text-based speech, and AI text analysis require extractable text. Detailed setup and limitations are documented in the [paper-reading guide](docs/paper-reading.md) (Chinese).

## Data and privacy

Books, progress, and notes are stored locally by default. Online sources, online speech, AI services, version checks, and WebDAV are optional network features. Data sent by a feature depends on the service you configure.

Library packages support moving books, papers, progress, annotations, and sources between compatible tools. They are not a complete application snapshot: settings, credentials, and paper-agent workspaces need separate handling. Review the [library package profile](docs/library-okf-profile.md) and [self-hosted library guide](docs/self-hosted-library.md) for details (Chinese).

## Build from source

Install Node.js, the Rust toolchain, and the platform prerequisites for Tauri 2, then run:

```bash
git clone https://github.com/yzfly/LightRead.git
cd LightRead
npm install
npm run tauri dev
```

Build the frontend or desktop application:

```bash
npm run build
npm run tauri build
```

The interface uses Vue 3 and TypeScript. Tauri 2/Rust supplies desktop filesystem access, SQLite, networking, and local process management. Ebook rendering uses foliate-js; PDF rendering uses MuPDF/PDFium. The web frontend uses IndexedDB for local storage, while desktop storage uses files and SQLite. Some capabilities, including local agent processes and offline speech models, require the desktop build.

## Contributing

Bug reports, feature suggestions, pull requests, and lawful public book-source suggestions are welcome. Please search [existing issues](https://github.com/yzfly/LightRead/issues) before opening a new one. For a bug report, include your app version, operating system, reproduction steps, and a sample file you have permission to share when applicable.

For code changes, explain the user-visible behavior, keep the change focused, and run the relevant checks listed in `package.json`. Update both Chinese and English UI translations for new user-facing strings. See [CLAUDE.md](CLAUDE.md) for repository development conventions.

## License and acknowledgments

LightRead is distributed under [GNU AGPL v3.0 or later](LICENSE). Third-party components retain their respective licenses.

Thanks to [foliate-js](https://github.com/johnfactotum/foliate-js), [MuPDF](https://mupdf.com/), [PDFium](https://pdfium.googlesource.com/pdfium/), and [BabelDOC](https://github.com/funstory-ai/BabelDOC). Screenshot books come from Project Gutenberg.
