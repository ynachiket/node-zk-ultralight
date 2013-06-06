#! /bin/bash

if [ ! $TEST_FILES ]; then
  TEST_FILES=$(find tests/ -type f -name "test-*.js" -print0 | tr "\0" " " | sed '$s/.$//')
fi

NODE_PATH=$(pwd)/lib-cov node_modules/whiskey/bin/whiskey \
  --coverage \
  --coverage-reporter html \
  --coverage-file ./coverage/cov.json \
  --coverage-dir ./coverage \
  -t "${TEST_FILES}"

