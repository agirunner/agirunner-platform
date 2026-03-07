#!/usr/bin/env bash
set -euo pipefail

# Runtime image strategy helper (v1.05 S3)
#
# Builds runtime image from a local runtime repository, tags it for private
# registry publishing, and writes an OCI tarball fallback artifact.

RUNTIME_REPO_PATH="${RUNTIME_REPO_PATH:-../agirunner-runtime}"
RUNTIME_DOCKERFILE="${RUNTIME_DOCKERFILE:-Dockerfile}"
LOCAL_RUNTIME_IMAGE="${LOCAL_RUNTIME_IMAGE:-agirunner-runtime:local}"
RUNTIME_IMAGE_REPO="${RUNTIME_IMAGE_REPO:-ghcr.io/agirunner/agirunner-runtime}"
RUNTIME_IMAGE_TAG="${RUNTIME_IMAGE_TAG:-}"
PUSH_IMAGE="${PUSH_IMAGE:-false}"
RELEASE_ENFORCE="${RELEASE_ENFORCE:-false}"
COSIGN_VERIFY_CMD="${COSIGN_VERIFY_CMD:-}"
SBOM_CMD="${SBOM_CMD:-}"
VULN_SCAN_CMD="${VULN_SCAN_CMD:-}"
OUT_DIR="${OUT_DIR:-dist/images}"

if [[ ! -d "$RUNTIME_REPO_PATH" ]]; then
  echo "[runtime-image-publish] runtime repo path not found: $RUNTIME_REPO_PATH" >&2
  exit 1
fi

if [[ -z "$RUNTIME_IMAGE_TAG" ]]; then
  RUNTIME_IMAGE_TAG="$(git -C "$RUNTIME_REPO_PATH" rev-parse --short=12 HEAD)"
fi

RUNTIME_IMAGE_REF="${RUNTIME_IMAGE_REPO}:${RUNTIME_IMAGE_TAG}"
TAR_PATH="${OUT_DIR}/agirunner-runtime-${RUNTIME_IMAGE_TAG}.tar"
MANIFEST_PATH="${OUT_DIR}/agirunner-runtime-${RUNTIME_IMAGE_TAG}.manifest.json"
COSIGN_OUTPUT_PATH="${OUT_DIR}/agirunner-runtime-${RUNTIME_IMAGE_TAG}.cosign.txt"
SBOM_OUTPUT_PATH="${OUT_DIR}/agirunner-runtime-${RUNTIME_IMAGE_TAG}.sbom.txt"
SCAN_OUTPUT_PATH="${OUT_DIR}/agirunner-runtime-${RUNTIME_IMAGE_TAG}.scan.txt"

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

DEPLOY_IMAGE_REF=""
if [[ -n "$PUSHED_DIGEST" ]]; then
  DEPLOY_IMAGE_REF="${RUNTIME_IMAGE_REPO}@${PUSHED_DIGEST}"
fi

COSIGN_STATUS="skipped"
if [[ -n "$COSIGN_VERIFY_CMD" && -n "$DEPLOY_IMAGE_REF" ]]; then
  echo "[runtime-image-publish] running cosign verification command"
  bash -lc "${COSIGN_VERIFY_CMD} \"${DEPLOY_IMAGE_REF}\"" | tee "$COSIGN_OUTPUT_PATH"
  COSIGN_STATUS="executed"
fi

SBOM_STATUS="skipped"
if [[ -n "$SBOM_CMD" && -n "$DEPLOY_IMAGE_REF" ]]; then
  echo "[runtime-image-publish] generating SBOM"
  bash -lc "${SBOM_CMD} \"${DEPLOY_IMAGE_REF}\"" | tee "$SBOM_OUTPUT_PATH"
  SBOM_STATUS="executed"
fi

SCAN_STATUS="skipped"
if [[ -n "$VULN_SCAN_CMD" && -n "$DEPLOY_IMAGE_REF" ]]; then
  echo "[runtime-image-publish] running vulnerability scan"
  bash -lc "${VULN_SCAN_CMD} \"${DEPLOY_IMAGE_REF}\"" | tee "$SCAN_OUTPUT_PATH"
  SCAN_STATUS="executed"
fi

COSIGN_OUTPUT_VALUE=""
if [[ "$COSIGN_STATUS" == "executed" ]]; then
  COSIGN_OUTPUT_VALUE="$COSIGN_OUTPUT_PATH"
fi

SBOM_OUTPUT_VALUE=""
if [[ "$SBOM_STATUS" == "executed" ]]; then
  SBOM_OUTPUT_VALUE="$SBOM_OUTPUT_PATH"
fi

SCAN_OUTPUT_VALUE=""
if [[ "$SCAN_STATUS" == "executed" ]]; then
  SCAN_OUTPUT_VALUE="$SCAN_OUTPUT_PATH"
fi

if [[ "$RELEASE_ENFORCE" == "true" ]]; then
  if [[ -z "$DEPLOY_IMAGE_REF" ]]; then
    echo "[runtime-image-publish] release enforcement requires a pushed digest reference" >&2
    exit 1
  fi
  if [[ "$COSIGN_STATUS" != "executed" ]]; then
    echo "[runtime-image-publish] release enforcement requires cosign verification output" >&2
    exit 1
  fi
  if [[ "$SBOM_STATUS" != "executed" ]]; then
    echo "[runtime-image-publish] release enforcement requires SBOM output" >&2
    exit 1
  fi
  if [[ "$SCAN_STATUS" != "executed" ]]; then
    echo "[runtime-image-publish] release enforcement requires vulnerability scan output" >&2
    exit 1
  fi
fi

TAR_SHA256="$(sha256sum "$TAR_PATH" | awk '{print $1}')"

cat > "$MANIFEST_PATH" <<JSON
{
  "runtimeRepoPath": "${RUNTIME_REPO_PATH}",
  "runtimeImage": "${RUNTIME_IMAGE_REF}",
  "deployImage": "${DEPLOY_IMAGE_REF}",
  "localImage": "${LOCAL_RUNTIME_IMAGE}",
  "pushedDigest": "${PUSHED_DIGEST}",
  "cosignStatus": "${COSIGN_STATUS}",
  "cosignOutput": "${COSIGN_OUTPUT_VALUE}",
  "sbomStatus": "${SBOM_STATUS}",
  "sbomOutput": "${SBOM_OUTPUT_VALUE}",
  "scanStatus": "${SCAN_STATUS}",
  "scanOutput": "${SCAN_OUTPUT_VALUE}",
  "tarball": "${TAR_PATH}",
  "tarballSha256": "${TAR_SHA256}",
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "[runtime-image-publish] manifest: $MANIFEST_PATH"
echo "[runtime-image-publish] done"
