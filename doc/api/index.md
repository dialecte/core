# API Overview

The `@dialecte/core` API is organised in two steps:

1. **Create** — import an XML file and instantiate a dialecte
2. **Consume** — start chains via [entrypoints](/api/entrypoints) and navigate, mutate, or query

## importXmlFiles

Streams one or more XML files through a SAX parser and persists each element tree to IndexedDB. Returns the database name created for each file.

```ts
import { importXmlFiles, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const [databaseName] = await importXmlFiles({
	files: [xmlFile],
	dialecteConfig: TEST_DIALECTE_CONFIG,
})
```

| Parameter             | Type                | Default | Description                                                               |
| --------------------- | ------------------- | ------- | ------------------------------------------------------------------------- |
| `files`               | `File[]`            | —       | Files to import; must match `io.supportedFileExtensions`                  |
| `dialecteConfig`      | `AnyDialecteConfig` | —       | Schema config                                                             |
| `useCustomRecordsIds` | `boolean`           | `false` | When `true`, reads `dev:db-id` attributes as record IDs (useful in tests) |

Returns `Promise<string[]>` — one database name per successfully imported file.

## createDialecte

Connects to an existing IndexedDB database and returns a dialecte instance ready to consume.

```ts
import { createDialecte, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const dialecte = await createDialecte({
	databaseName, // returned by importXmlFiles
	dialecteConfig: TEST_DIALECTE_CONFIG,
	extensions: {},
})
```

| Parameter        | Type                | Description                                       |
| ---------------- | ------------------- | ------------------------------------------------- |
| `databaseName`   | `string`            | Name of the IndexedDB database to connect to      |
| `dialecteConfig` | `AnyDialecteConfig` | The config describing your XML schema             |
| `extensions`     | `ExtensionRegistry` | Domain extension methods to inject into the chain |

Returns `Promise<DialecteCore>`.

Once you have a `dialecte` instance, start a chain from [fromRoot or fromElement](/api/entrypoints).

## exportXmlFile

Reconstructs and serialises the XML tree from IndexedDB. Optionally triggers a browser download.

```ts
import { exportXmlFile, TEST_DIALECTE_CONFIG } from '@dialecte/core'

const { xmlDocument, filename } = await exportXmlFile({
	databaseName,
	extension: '.xml',
	withDownload: true,
	dialecteConfig: TEST_DIALECTE_CONFIG,
})
```

| Parameter        | Type                 | Default | Description                                             |
| ---------------- | -------------------- | ------- | ------------------------------------------------------- |
| `databaseName`   | `string`             | —       | Database to export                                      |
| `extension`      | `SupportedExtension` | —       | File extension; must be in `io.supportedFileExtensions` |
| `withDownload`   | `boolean`            | `false` | Triggers a browser `<a download>` after export          |
| `dialecteConfig` | `AnyDialecteConfig`  | —       | Schema config                                           |

Returns `Promise<{ xmlDocument: XMLDocument; filename: string }>`.
