# PhenoHandbook — Build system alias (just = make replacement)
set dotenv-load

# default: list recipes
default:
    @just --list

# install
install:
    @echo "TODO: install PhenoHandbook deps"

# build
build:
    @echo "TODO: build PhenoHandbook"

# test
test:
    @echo "TODO: test PhenoHandbook"

# lint
lint:
    @echo "TODO: lint PhenoHandbook"

# format
format:
    @echo "TODO: format PhenoHandbook"

# verify (justfile-verify-in-pre-commit hook gate)
verify:
    @just --evaluate
