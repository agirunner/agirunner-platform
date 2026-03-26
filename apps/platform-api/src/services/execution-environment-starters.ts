import type {
  ExecutionEnvironmentCatalogRecord,
  ExecutionEnvironmentPullPolicy,
  ExecutionEnvironmentSupportStatus,
} from './execution-environment-contract.js';

type StarterRecord = Omit<ExecutionEnvironmentCatalogRecord, 'created_at'>;

function starter(input: {
  catalog_key: string;
  catalog_version: number;
  name: string;
  description: string;
  image: string;
  cpu?: string;
  memory?: string;
  pull_policy?: ExecutionEnvironmentPullPolicy;
  bootstrap_commands?: string[];
  bootstrap_required_domains?: string[];
  declared_metadata: Record<string, unknown>;
  support_status?: ExecutionEnvironmentSupportStatus;
  replacement_catalog_key?: string | null;
  replacement_catalog_version?: number | null;
}): StarterRecord {
  return {
    catalog_key: input.catalog_key,
    catalog_version: input.catalog_version,
    name: input.name,
    description: input.description,
    image: input.image,
    cpu: input.cpu ?? '2',
    memory: input.memory ?? '1Gi',
    pull_policy: input.pull_policy ?? 'if-not-present',
    bootstrap_commands: input.bootstrap_commands ?? [],
    bootstrap_required_domains: input.bootstrap_required_domains ?? [],
    declared_metadata: input.declared_metadata,
    support_status: input.support_status ?? 'active',
    replacement_catalog_key: input.replacement_catalog_key ?? null,
    replacement_catalog_version: input.replacement_catalog_version ?? null,
  };
}

export const BUILT_IN_EXECUTION_ENVIRONMENT_CATALOG: StarterRecord[] = [
  starter({
    catalog_key: 'debian-base',
    catalog_version: 1,
    name: 'Debian Base',
    description: 'Curated Debian starter with a slim userspace baseline.',
    image: 'debian:trixie-slim',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      distro_version: 'trixie',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'ubuntu-base',
    catalog_version: 1,
    name: 'Ubuntu LTS Base',
    description: 'Ubuntu LTS starter for apt-based developer workflows.',
    image: 'ubuntu:24.04',
    declared_metadata: {
      os_family: 'linux',
      distro: 'ubuntu',
      distro_version: '24.04',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'alpine-base',
    catalog_version: 1,
    name: 'Alpine Base',
    description: 'Small Alpine starter for apk-based workflows.',
    image: 'alpine:3.23',
    declared_metadata: {
      os_family: 'linux',
      distro: 'alpine',
      distro_version: '3.23',
      package_manager: 'apk',
      shell: '/bin/sh',
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'fedora-base',
    catalog_version: 1,
    name: 'Fedora Base',
    description: 'Fedora starter for dnf and microdnf package flows.',
    image: 'fedora:42',
    declared_metadata: {
      os_family: 'linux',
      distro: 'fedora',
      distro_version: '42',
      package_manager: 'dnf',
      shell: '/bin/sh',
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'python-base',
    catalog_version: 1,
    name: 'Python Base',
    description: 'Official Python starter with a current CPython toolchain.',
    image: 'python:3.13-slim',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['python'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'node-base',
    catalog_version: 1,
    name: 'Node LTS Base',
    description: 'Official Node LTS starter for JavaScript and TypeScript work.',
    image: 'node:22-bookworm-slim',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['node'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'go-base',
    catalog_version: 1,
    name: 'Go Base',
    description: 'Official Go starter for Go toolchain workflows.',
    image: 'golang:1.24-bookworm',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['go'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'rust-base',
    catalog_version: 1,
    name: 'Rust Base',
    description: 'Official Rust starter for cargo-based workflows.',
    image: 'rust:1.87-bookworm',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['rust'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'java-base',
    catalog_version: 1,
    name: 'Java Base',
    description: 'Official Java starter with a current LTS JDK.',
    image: 'eclipse-temurin:21-jdk',
    declared_metadata: {
      os_family: 'linux',
      distro: 'ubuntu',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['java'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
  starter({
    catalog_key: 'php-base',
    catalog_version: 1,
    name: 'PHP Base',
    description: 'Official PHP CLI starter.',
    image: 'php:8.4-cli-bookworm',
    declared_metadata: {
      os_family: 'linux',
      distro: 'debian',
      package_manager: 'apt-get',
      shell: '/bin/sh',
      detected_runtimes: ['php'],
      docker_access_mode: 'none',
      docker_cli_present: false,
    },
  }),
];

export const DEFAULT_EXECUTION_ENVIRONMENT_CATALOG_KEY = 'debian-base';
export const DEFAULT_EXECUTION_ENVIRONMENT_CATALOG_VERSION = 1;
