# Setup Upload Balena release asset Action

This action uploads a file as a balena release asserts.

## Usage

```yaml
uses: balena-io/upload-balena-release-asset@main
with:

  # balenaCloud API token to login automatically.
  # Required.
  balena-token:

  # The release id this asset belongs to.
  # Required.
  release-id:

  # The unique key per release of this asset.
  # Required.
  asset-key:

  # The Path of the file to upload.
  # Required.
  file-path:

  # If true, an asset with a matching asset-key will be deleted before a new one is uploaded.
  # If false, the action will fail if an asset for the given asset-key already exists.
  # Does not fail if the asset-key does not exist.
  # Optional. Default 'false'
  overwrite:

  # The desired behavior if no files are found using the provided path.
  # Available Options:
  #   warn: Output a warning but do not fail the action
  #   error: Fail the action with an error message
  #   ignore: Do not output any warnings or errors, the action does not fail
  # Optional. Default 'warn'
  if-file-path-not-found:

  # Domain for the backend services to upload your asset.
  # Optional. Default 'balena-cloud.com'
  balena-host:

  # The size of the chunks to split the file into when uploading.
  # If the file is smaller than this size, it will be uploaded in one go.
  # Minimum size is 5242880 (5MB).
  # Optional. Default '104857600' (100MB)
  chunk-size:

  # The number of parallel chunks to upload at the same time.
  # Optional. Default '4'
  parallel-chunks:

```

## Examples

### Uploads a file as a release asset

```yaml
- name: Upload release asset
  uses: balena-io/upload-balena-release-asset@main
  with:
    balena-token: "*****"
    release-id: 123456
    asset-key: "licenses"
    file-path: "/some/path/licenses.tgz"
```

### Uploads a file as a release asset on staging overwriting in case one existed with custom upload chunk size and parallel chunks

```yaml
- name: Upload release asset
  uses: balena-io/upload-balena-release-asset@main
  with:
    balena-token: "*****"
    release-id: 123456
    asset-key: "licenses"
    file-path: "/some/path/licenses.tgz"
    overwrite: true
    balena-host: "balena-staging.com"
    chunk-size: 5242880
    parallel-chunks: 20
```

## Running locally and developing this action
### Prerequisites
- [Node.js](https://nodejs.org/en/download/) (v20 or later)

### Install dependencies
```bash
npm install
```

### Run it locally
```bash
npm run local-action
```

### Run tests
```bash
npm test
```
