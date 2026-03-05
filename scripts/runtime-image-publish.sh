#!/usr/bin/env bash
set -euo pipefail

# Runtime image strategy helper (v1.05 S3)
#
# Builds runtime image from a local runtime repository, tags it for private
# registry publishing, and writes an OCI tarball fallback artifact.

RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH:-../agentbaton-runtime}"
RUNTIME_DOCKERFILE="${RUNTIME_DOCKERFILE:-Dockerfile}"
LOCAL_RUNTIME_IMAGE="${LOCAL_RUNTIME_IMAGE:-agentbaton-runtime:local}"
RUNTIME_IMAGE_REPO="${RUNTIME_IMAGE_REPO:-registry.github.com/enterprise-private/agentbaton-runtime}"
RUNTIME_IMAGE_TAG="${RUNTIME_IMAGE_TAG:-}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"
OUT_DIR="${OUT_DIR:-dist/images}"

if [[ ! -d "$RUNTIME_REPO_PATH" ]]; then
  echo "[runtime-image-publish] runtime repo path not found: $RUNTIME_REPO_PATH" >&2
  exit 1
fi

if [[ -z "$RUNTIME_IMAGE_TAG" ]]; then
  RUNTIME_IMAGE_TAG="$(git -C "$RUNTIME_REPO_PATH" rev-parse --short=12 HEAD)"
fi

RUNTIME_IMAGE_REF="${RUNTIME_IMAGE_REPO}:${RUNTIME_IMAGE_TAG}"
TAR_PATH="${OUT_DIR}/agentbaton-runtime-${RUNTIME_IMAGE_TAG}.tar"
MANIFEST_PATH="${OUT_DIR}/agentbaton-runtime-${RUNTIME_IMAGE_TAG}.manifest.json"

mkdir -p "$OUT_DIR"

echo "[runtime-image-publish] building local runtime image: $LOCAL_RUNTIME_IMAGE"
docker build \
  -f "${RUNTIME_REPO_PATH}/${RUNTIME_DOCKERFILE}" \
  -t "$LOCAL_RUNTIME_IMAGE" \
  "$RUNTIME_REPO_PATH"

echo "[runtime-image-publish] tagging runtime image: $RUNTIME_IMAGE_REF"
docker tag "$LOCAL_RUNTIME_IMAGE" "$RUNTIME_IMAGE_REF"

echo "[runtime-image-publish] exporting OCI tar fallback: $TAR_PATH"
docker save -o "$TAR_PATH" "$RUNTIME_IMAGE_REF"

PUSHED_DIGEST=""
if [[ "$PUSH_IMAGE" == "true" ]]; then
  echo "[runtime-image-publish] pushing runtime image: $RUNTIME_IMAGE_REF"
  docker push "$RUNTIME_IMAGE_REF"
  PUSHED_DIGEST="$(docker buildx imagetools inspect "$RUNTIME_IMAGE_REF" --format '{{json .Manifest.Digest}}' 2>/dev/null | tr -d '"')"
fi

TAR_SHA256="$(sha256sum "$TAR_PATH" | awk '{print $1}')"

cat > "$MANIFEST_PATH" <<JSON
{
  "runtimeRepoPath": "${RUNTIME_REPO_PATH}",
  "runtimeImage": "${RUNTIME_IMAGE_REF}",
  "localImage": "${LOCAL_RUNTIME_IMAGE}",
  "pushedDigest": "${PUSHED_DIGEST}",
  "tarball": "${TAR_PATH}",
  "tarballSha256": "${TAR_SHA256}",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "[runtime-image-publish] manifest: $MANIFEST_PATH"
echo "[runtime-image-publish] done"
