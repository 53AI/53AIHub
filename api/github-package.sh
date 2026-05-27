#!/bin/bash

set -e

PROJECT_NAME="53AIHub"
VERSION=$(cat VERSION 2>/dev/null || echo "dev")
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT_DIR="dist"
ARCHIVE_NAME="${PROJECT_NAME}_opensource_${VERSION}_${TIMESTAMP}.tar.gz"

DEBUG_MODE=false

for arg in "$@"; do
    case $arg in
        --debug|-d)
            DEBUG_MODE=true
            ;;
    esac
done

EXCLUDE_DIRS="logs data upload temp build dist .idea .vscode .codebuddy .cursor .claude .trae .opencode .sisyphus .tasks .lingma .docs .gitcode .github .kilo vendor desensitized saas cmd guides scripts tests web .git tools sandbox"

EXCLUDE_OPTS=(
    --include=docs/.gitignore
    --include=docs/docs.go
    --include=docs/swagger.json
    --include=docs/swagger.yaml
    --exclude='/docs/*'
    --exclude='/docs/*/'
    --include='config/default/*'
    --include='static/docs/index.html'
    --include='static/console/.embedkeep'
    --include='static/front/.embedkeep'
    --exclude='.git'
    --exclude='.gitmessage'
    --exclude='.gitattributes'
    --exclude='.gitmodules'
    --exclude='.gitkeep'
    --exclude='.env'
    --exclude='.envkm'
    --exclude='.envtest'
    --exclude='*.db'
    --exclude='*.db-journal'
    --exclude='*.exe'
    --exclude='*.log'
    --exclude='*.md'
    --exclude='*_test.go'
    --exclude=AGENTS.md
    --exclude=build.sh
    --exclude=build-restart-develop.sh
    --exclude=debug_vector.sh
    --exclude=Dockerfile.local
    --exclude=embed_saas.go
    --exclude=github-package.sh
    --exclude=53AIHub
    --exclude=migrate_tool
    --exclude='__debug_bin*'
    --exclude=logs
    --exclude=data
    --exclude=upload
    --exclude=temp
    --exclude=build
    --exclude=dist
    --exclude=.idea
    --exclude=.vscode
    --exclude=.codebuddy
    --exclude=.cursor
    --exclude=.claude
    --exclude=.trae
    --exclude=.opencode
    --exclude=.sisyphus
    --exclude=.tasks
    --exclude=.lingma
    --exclude=.docs
    --exclude=.gitcode
    --exclude=.github
    --exclude=.kilo
    --exclude='bin/*.hub'
    --exclude=bin/rsync.sh
    --exclude=bin/saveNginxConf.sh
    --exclude=bin/delNginxConf.sh
    --exclude=bin/renewNginxCerts.sh
    --exclude='bin/.env*'
    --exclude=docker/backup.sh
    --exclude=docker/update_km_image.sh
    --exclude=docker/docker-compose.saas.yml
    --exclude=docker/docker-compose.onprem.yml
    --exclude=docker/.env.example
    --exclude=docker/go.mod
    --exclude='docker/nginx/html/*'
    --exclude='docker/data/*'
    --exclude='static/uploads/*'
    --exclude='static/console/*'
    --exclude='static/front/*'
    --exclude=vendor
    --exclude=AI_TASK.txt
    --exclude='*.zip'
    --exclude=desensitized
    --exclude=saas
    --exclude='*_saas.go'
    --exclude=cmd
    --exclude=guides
    --exclude=/sandbox
    --exclude=scripts
    --exclude=tests
    --exclude=/tools
    --exclude=web
)

if [ "$DEBUG_MODE" == "true" ]; then
    echo "=== 调试模式：预览将被排除的文件/目录 ==="
    echo ""

    echo "【将被排除的目录】"
    for dir in $EXCLUDE_DIRS; do
        if [ -d "$dir" ]; then
            echo "  $dir"
        fi
    done

    echo ""
    echo "【将被排除的文件】"
    find . -maxdepth 1 -type f \( \
        -name '*.db' -o \
        -name '*.db-journal' -o \
        -name '*.exe' -o \
        -name '*.log' -o \
        -name '*.md' -o \
        -name '*.zip' -o \
        -name '.env' -o \
        -name '.envkm' -o \
        -name '.envtest' -o \
        -name '.gitignore' -o \
        -name '.gitmessage' -o \
        -name 'AGENTS.md' -o \
        -name 'build.sh' -o \
        -name 'build-restart-develop.sh' -o \
        -name 'debug_vector.sh' -o \
        -name 'Dockerfile.local' -o \
        -name 'embed_saas.go' -o \
        -name 'graph_template_seed.json' -o \
        -name '53AIHub' -o \
        -name 'migrate_tool' -o \
        -name '__debug_bin*' -o \
        -name 'AI_TASK.txt' \
    \) 2>/dev/null | while read f; do echo "  $f"; done

    find . -type f \( -name '*_saas.go' -o -name '*_test.go' \) 2>/dev/null | while read f; do echo "  $f"; done

    echo ""
    echo "【将被清空的目录内容】"
    echo "  docker/nginx/html/*"
    echo "  docker/data/*"
    echo "  static/uploads/*"
    echo "  static/console/*（保留 .embedkeep）"
    echo "  static/front/*（保留 .embedkeep）"

    TOTAL_DIRS=0
    for dir in $EXCLUDE_DIRS; do
        if [ -d "$dir" ]; then
            TOTAL_DIRS=$((TOTAL_DIRS + 1))
        fi
    done
    TOTAL_FILES=$(find . -maxdepth 1 -type f \( \
        -name '*.db' -o \
        -name '*.db-journal' -o \
        -name '*.exe' -o \
        -name '*.log' -o \
        -name '*.md' -o \
        -name '*.zip' -o \
        -name '.env' -o \
        -name '.envkm' -o \
        -name '.envtest' -o \
        -name '.gitignore' -o \
        -name '.gitmessage' -o \
        -name 'AGENTS.md' -o \
        -name 'build.sh' -o \
        -name 'build-restart-develop.sh' -o \
        -name 'debug_vector.sh' -o \
        -name 'Dockerfile.local' -o \
        -name 'embed_saas.go' -o \
        -name 'graph_template_seed.json' -o \
        -name '53AIHub' -o \
        -name 'migrate_tool' -o \
        -name '__debug_bin*' -o \
        -name 'AI_TASK.txt' \
    \) 2>/dev/null | wc -l)
    SAAS_FILES=$(find . -type f -name '*_saas.go' 2>/dev/null | wc -l)
    TEST_FILES=$(find . -type f -name '*_test.go' 2>/dev/null | wc -l)
    TOTAL_FILES=$((TOTAL_FILES + SAAS_FILES + TEST_FILES))

    echo ""
    echo "【统计】"
    echo "  将排除目录: $TOTAL_DIRS 个"
    echo "  将排除文件: $TOTAL_FILES 个"

else
    echo "=== 打包 ${PROJECT_NAME} 开源版 v${VERSION} ==="

    rm -rf "$OUTPUT_DIR"
    mkdir -p "$OUTPUT_DIR"

    TEMP_DIR=$(mktemp -d)
    trap "rm -rf $TEMP_DIR" EXIT

    rsync -av "${EXCLUDE_OPTS[@]}" ./ "$TEMP_DIR/$PROJECT_NAME/"

    cd "$TEMP_DIR"
    tar -czf "$OLDPWD/$OUTPUT_DIR/$ARCHIVE_NAME" "$PROJECT_NAME"

    cd "$OLDPWD"

    echo ""
    echo "=== 打包完成 ==="
    echo "文件: $OUTPUT_DIR/$ARCHIVE_NAME"
    echo "大小: $(du -h "$OUTPUT_DIR/$ARCHIVE_NAME" | cut -f1)"
fi
