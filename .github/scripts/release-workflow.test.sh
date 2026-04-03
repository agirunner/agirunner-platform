#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKFLOW_PATH="${SCRIPT_DIR}/../workflows/platform-manual-release.yml"

ruby - "${WORKFLOW_PATH}" <<'RUBY'
require "yaml"

workflow_path = ARGV.fetch(0)
workflow = YAML.load_file(workflow_path)
steps = workflow.fetch("jobs").fetch("create_release").fetch("steps")

release_index = steps.index { |step| step["name"] == "Create GitHub release and tag" }
abort("missing GitHub release step") if release_index.nil?

checkout_index = steps.index { |step| step["uses"] == "actions/checkout@v4" }
abort("missing checkout step") if checkout_index.nil?
abort("checkout must run before the release step") if checkout_index > release_index

release_run = steps.fetch(release_index).fetch("run")
abort("release step must keep --generate-notes coverage") unless release_run.include?("--generate-notes")
RUBY
