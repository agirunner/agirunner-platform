#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_PATH="${SCRIPT_DIR}/../workflows/platform-manual-build.yml"
TAG_VALIDATOR="${SCRIPT_DIR}/release-tags.sh"

ruby - "${WORKFLOW_PATH}" "${TAG_VALIDATOR}" <<'RUBY'
require "yaml"

workflow_path, validator = ARGV
workflow = YAML.load_file(workflow_path)
inputs = workflow.fetch(true).fetch("workflow_dispatch").fetch("inputs")
image_tag = inputs.fetch("image_tag").fetch("default").to_s

abort("manual build workflow must define a default image_tag") if image_tag.empty?

system("bash", validator, "validate-image-tag", image_tag, exception: true)
RUBY
