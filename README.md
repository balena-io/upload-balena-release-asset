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

  # A file, directory or wildcard pattern that describes what to upload
  # Required.
  path:

  # A prefix to prepend to the asset key for the uploaded files.
  # By default the slugified file name with relative paht is used as key.
  # If a key-prefix is provided, the slugified file name will be appended to it.
  # Optional. Default is '' (empty).
  key-prefix:

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
  if-no-files-found:

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
    path: "/some/path/licenses.tgz"
```

### Uploads a file as a release asset on staging overwriting in case one existed with custom upload chunk size and parallel chunks

```yaml
- name: Upload release asset
  uses: balena-io/upload-balena-release-asset@main
  with:
    balena-token: "*****"
    release-id: 123456
    key-prefix: "prefix/"
    file-path: |
      /some/path/licenses.tgz
      /some/other/
      !/some/other/excluded-file.txt
    if-no-files-found: "error"
    overwrite: true
    balena-host: "balena-staging.com"
    chunk-size: 5242880
    parallel-chunks: 20
```

## About asset keys and paths
The asset key is a unique identifier for the asset within the release. By default, the action uses the slugified file name with its least common ancestor relative path as the asset key. If you provide a `key-prefix`, it will append the slugified file name to that prefix.

For example, if you only upload a file located at `/some/path/licenses.tgz`, the default asset key would be `licenses.tgz`. If you set `key-prefix` to `my-prefix/`, the asset key would be `my-prefix/licenses.tgz`.

More over, if you have a folder structure like this:

```
/some/path/licenses.tgz
/some/other/file.txt
/some/other/another/file.txt
/some/other/excluded-file.txt
```

with the above action (which has a `key-prefix` of `prefix/`), the asset keys would be:

```
prefix/path/licenses.tgz
prefix/other/file.txt
prefix/other/another/file.txt
# and nothing for excluded-file.txt as it is excluded by the pattern
```

Note that for this example the least common ancestor is the `/some/` directory.

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
