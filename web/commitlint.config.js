module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 类型枚举，git提交type必须是以下类型
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新增功能
        'fix', // 修复缺陷
        'docs', // 文档变更
        'style', // 代码格式（不影响功能，例如空格、分号等格式修正）
        'refactor', // 代码重构（不包括 bug 修复、功能新增）
        'perf', // 性能优化
        'test', // 添加疏漏测试或已有测试改动
        'build', // 构建流程、外部依赖变更（如升级 npm 包、修改 webpack 配置等）
        'ci', // 修改 CI 配置、脚本
        'chore', // 对构建过程或辅助工具和库的更改（不影响源文件、测试用例）
        'revert', // 回滚 commit
        'wip', // 开发中
        'workflow', // 工作流程改进
        'types' // 类型声明或修改
      ]
    ],
    // subject 大小写不做校验
    'subject-case': [0],
    // subject 不允许为空
    'subject-empty': [2, 'never'],
    // subject 以什么为结束标志，禁用
    'subject-full-stop': [0, 'never'],
    // type 必须小写
    'type-case': [2, 'always', 'lower-case'],
    // type 不能为空
    'type-empty': [2, 'never']
  }
}
