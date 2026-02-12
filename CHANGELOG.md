# Changelog

## [2.1.0](https://github.com/sidorares/show-component/compare/show-component-v2.0.3...show-component-v2.1.0) (2026-02-12)


### Features

* add `debug` prop for detailed source resolution logging ([cf6c30f](https://github.com/sidorares/show-component/commit/cf6c30f87081747dc6dbf4e1e41e84ec72414136))

## [2.0.3](https://github.com/sidorares/show-component/compare/show-component-v2.0.2...show-component-v2.0.3) (2026-02-12)


### Bug Fixes

* prevent text selection on Alt+right-click ([685435d](https://github.com/sidorares/show-component/commit/685435d6d5f9496ae245452e1e487b44859f9e7f))

## [2.0.2](https://github.com/sidorares/show-component/compare/show-component-v2.0.1...show-component-v2.0.2) (2026-02-10)


### Bug Fixes

* re-trigger release after failed 2.0.1 publish ([e6fa500](https://github.com/sidorares/show-component/commit/e6fa5004ed3f536f5d3fbf773e84b862e4cd9096))

## [2.0.1](https://github.com/sidorares/show-component/compare/show-component-v2.0.0...show-component-v2.0.1) (2026-02-10)


### Bug Fixes

* apply lint/format fixes and add vitest config ([9258308](https://github.com/sidorares/show-component/commit/9258308452a2095314c7884de3a5774eb0f6e6ae))

## [2.0.0](https://github.com/sidorares/show-component/compare/show-component-v1.2.0...show-component-v2.0.0) (2026-02-10)


### ⚠ BREAKING CHANGES

* PopoverContent no longer applies default Tailwind classes. Consumers who relied on overriding those classes via the `className` prop should use the `style` prop instead.

### Bug Fixes

* handle `about://React/Server/` URLs in stack frames ([05d7eb3](https://github.com/sidorares/show-component/commit/05d7eb3f40b5e2d99a77fd0eb9b691fe54efce1b))


### Code Refactoring

* remove Tailwind CSS dependency from popover component ([b7d0ae9](https://github.com/sidorares/show-component/commit/b7d0ae94585f13b101e1e55d4db062c12b4b90f4))

## [1.2.0](https://github.com/sidorares/show-component/compare/show-component-v1.1.1...show-component-v1.2.0) (2026-02-09)


### Features

* add `editorScheme` prop for configurable editor protocol ([1e4e24a](https://github.com/sidorares/show-component/commit/1e4e24a2aea5a8168a5b4860dad6961a5a46e361))
* add `getClickTarget` prop for customising Alt+Click navigation target ([0c65b47](https://github.com/sidorares/show-component/commit/0c65b475a3ae99b016fc8da71a5d55f192a36387))

## [1.1.1](https://github.com/sidorares/show-component/compare/show-component-v1.1.0...show-component-v1.1.1) (2026-02-09)


### Bug Fixes

* format import to single line ([ed1036c](https://github.com/sidorares/show-component/commit/ed1036ccf84557d63207345aaab406cd3fd9a72f))

## [1.1.0](https://github.com/sidorares/show-component/compare/show-component-v1.0.1...show-component-v1.1.0) (2026-02-08)


### Features

* migrate code with main functionality to this repo ([#11](https://github.com/sidorares/show-component/issues/11)) ([08eda42](https://github.com/sidorares/show-component/commit/08eda423c203cd0048c7a7207f362603f3b03995))

## [1.0.1](https://github.com/sidorares/show-component/compare/show-component-v1.0.0...show-component-v1.0.1) (2025-09-16)


### Bug Fixes

* consolidate release workflow ([#9](https://github.com/sidorares/show-component/issues/9)) ([a17de12](https://github.com/sidorares/show-component/commit/a17de1214ff71c654b8f862ab882ee89cdaaa062))
* update release please action ([#7](https://github.com/sidorares/show-component/issues/7)) ([f503afe](https://github.com/sidorares/show-component/commit/f503afe6c18603efaceada72cd68471b3b6c931f))

## 1.0.0 (2025-09-16)


### Bug Fixes

* update release please action ([#7](https://github.com/sidorares/show-component/issues/7)) ([f503afe](https://github.com/sidorares/show-component/commit/f503afe6c18603efaceada72cd68471b3b6c931f))
