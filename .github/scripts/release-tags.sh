#!/usr/bin/env bash
set -euo pipefail

readonly RELEASE_REGEX='^([0-9]+)\.([0-9]+)\.([0-9]+)(-((alpha|beta|rc))\.([0-9]+))?$'

usage() {
  cat <<'EOF' >&2
Usage:
  release-tags.sh validate-git-tag <git-tag>
  release-tags.sh validate-image-tag <image-tag>
  release-tags.sh git-tag-from-image-tag <image-tag>
  release-tags.sh release-class-from-image-tag <image-tag>
  release-tags.sh publish-tags-from-git-tag <git-tag>
  release-tags.sh publish-tags-from-image-tag <image-tag>
EOF
  exit 1
}

fail() {
  echo "$*" >&2
  exit 1
}

parse_version() {
  local version="$1"
  if [[ ! "${version}" =~ ${RELEASE_REGEX} ]]; then
    fail "Version must match <major>.<minor>.<patch> or <major>.<minor>.<patch>-(alpha|beta|rc).<n>"
  fi
}

validate_git_tag() {
  local git_tag="$1"
  [[ "${git_tag}" == v* ]] || fail "Git tag must start with v"
  local version="${git_tag#v}"
  parse_version "${version}"
  printf '%s\n' "${version}"
}

validate_image_tag() {
  local image_tag="$1"
  parse_version "${image_tag}"
  printf '%s\n' "${image_tag}"
}

git_tag_from_image_tag() {
  local image_tag
  image_tag="$(validate_image_tag "$1")"
  printf 'v%s\n' "${image_tag}"
}

release_class_from_image_tag() {
  local image_tag
  image_tag="$(validate_image_tag "$1")"

  if [[ "${image_tag}" == *-* ]]; then
    printf 'prerelease\n'
    return
  fi

  printf 'release\n'
}

emit_publish_tags() {
  local version="$1"
  parse_version "${version}"
  printf '%s\n' "${version}"
  printf 'latest\n'
}

main() {
  [[ $# -eq 2 ]] || usage
  local command="$1"
  local value="$2"

  case "${command}" in
    validate-git-tag)
      validate_git_tag "${value}"
      ;;
    validate-image-tag)
      validate_image_tag "${value}"
      ;;
    git-tag-from-image-tag)
      git_tag_from_image_tag "${value}"
      ;;
    release-class-from-image-tag)
      release_class_from_image_tag "${value}"
      ;;
    publish-tags-from-git-tag)
      emit_publish_tags "$(validate_git_tag "${value}")"
      ;;
    publish-tags-from-image-tag)
      emit_publish_tags "$(validate_image_tag "${value}")"
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
