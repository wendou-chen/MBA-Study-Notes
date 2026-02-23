# Codex 执行计划：kaoyan-countdown 插件 AI 设置面板

项目根目录：当前工作目录（Obsidian Vault）

修改 4 个文件，为 kaoyan-countdown 插件添加 AI 模型配置功能，并让 auto_daily_plan.py 从插件设置读取 API 配置。

---

## 任务 1：修改 `.obsidian/plugins/kaoyan-countdown/src/types.ts`

在文件中添加以下类型和常量（放在 `FocusSettings` 接口之前）：

```typescript
export type AiProvider = 'anthropic' | 'openai' | 'deepseek';

export interface AiSettings {
  provider: AiProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: 'anthropic',
  apiKey: '',
  baseUrl: '',
  model: 'claude-opus-4-6-20250616',
};
```

在 `KaoyanSettings` 接口中添加字段：
```typescript
ai: AiSettings;
```

在 `DEFAULT_SETTINGS` 中添加：
```typescript
ai: { ...DEFAULT_AI_SETTINGS },
```

同时在 `main.ts` 的 import 中添加 `DEFAULT_AI_SETTINGS`，在 `loadSettings()` 方法中添加：
```typescript
this.settings.ai = Object.assign({}, DEFAULT_AI_SETTINGS, data.ai);
```

---

## 任务 2：修改 `.obsidian/plugins/kaoyan-countdown/src/settingsTab.ts`

在 `display()` 方法末尾（专注模式设置之后），添加 AI 模型配置区域：

```typescript
// ── AI 模型配置 ──
containerEl.createEl('h3', { text: 'AI 模型配置' });

const providerPlaceholders: Record<string, { url: string; model: string }> = {
  anthropic: { url: 'https://api.anthropic.com', model: 'claude-opus-4-6-20250616' },
  openai: { url: 'https://api.openai.com/v1', model: 'gpt-4o' },
  deepseek: { url: 'https://api.deepseek.com', model: 'deepseek-chat' },
};

new Setting(containerEl)
  .setName('AI 服务商')
  .setDesc('选择 AI API 提供商')
  .addDropdown(dropdown => dropdown
    .addOption('anthropic', 'Anthropic (Claude)')
    .addOption('openai', 'OpenAI (GPT)')
    .addOption('deepseek', 'DeepSeek')
    .setValue(this.plugin.settings.ai.provider)
    .onChange(async (value) => {
      this.plugin.settings.ai.provider = value as any;
      this.plugin.settings.ai.baseUrl = '';
      this.plugin.settings.ai.model = '';
      await this.plugin.saveSettings();
      this.display();
    }));

new Setting(containerEl)
  .setName('API Key')
  .setDesc('留空则使用 .env 文件中的配置')
  .addText(text => {
    text.inputEl.type = 'password';
    text.setPlaceholder('sk-...')
      .setValue(this.plugin.settings.ai.apiKey)
      .onChange(async (value) => {
        this.plugin.settings.ai.apiKey = value.trim();
        await this.plugin.saveSettings();
      });
  });

const currentProvider = this.plugin.settings.ai.provider;
const ph = providerPlaceholders[currentProvider] || providerPlaceholders.anthropic;

new Setting(containerEl)
  .setName('Base URL')
  .setDesc('自定义 API 地址（留空使用默认）')
  .addText(text => text
    .setPlaceholder(ph.url)
    .setValue(this.plugin.settings.ai.baseUrl)
    .onChange(async (value) => {
      this.plugin.settings.ai.baseUrl = value.trim();
      await this.plugin.saveSettings();
    }));

new Setting(containerEl)
  .setName('模型名称')
  .setDesc('留空使用默认模型')
  .addText(text => text
    .setPlaceholder(ph.model)
    .setValue(this.plugin.settings.ai.model)
    .onChange(async (value) => {
      this.plugin.settings.ai.model = value.trim();
      await this.plugin.saveSettings();
    }));
```

需要在文件顶部 import 中添加 `AiProvider`（如果 TypeScript 需要的话）。

---

## 任务 3：修改 `.scripts/auto_daily_plan.py`

将现有的 `call_claude()` 函数替换为多 provider 支持。具体修改：

### 3.1 新增 `load_ai_settings()` 函数（在 `call_claude` 之前）

```python
def load_ai_settings(repo_root: Path) -> dict[str, Any]:
    """从插件 data.json 读取 AI 设置，回退到 .env 环境变量"""
    data_json = repo_root / ".obsidian" / "plugins" / "kaoyan-countdown" / "data.json"
    if data_json.exists():
        try:
            data = json.loads(data_json.read_text(encoding="utf-8"))
            ai = data.get("ai", {})
            if ai.get("apiKey"):
                return {
                    "provider": ai.get("provider", "anthropic"),
                    "apiKey": ai["apiKey"],
                    "baseUrl": ai.get("baseUrl", ""),
                    "model": ai.get("model", ""),
                }
        except (json.JSONDecodeError, KeyError):
            pass

    return {
        "provider": "anthropic",
        "apiKey": os.getenv("ANTHROPIC_API_KEY", ""),
        "baseUrl": os.getenv("ANTHROPIC_BASE_URL", ""),
        "model": os.getenv("ANTHROPIC_MODEL", "claude-opus-4-6-20250616"),
    }
```

### 3.2 将 `call_claude()` 拆分为三个函数

保留原有 `call_claude` 的 Anthropic 逻辑作为 `_call_anthropic()`，新增 `_call_openai_compatible()`，用 `call_ai()` 作为入口：

```python
def _call_anthropic(prompt: str, settings: dict[str, Any]) -> str:
    api_key = settings["apiKey"]
    if not api_key:
        raise RuntimeError("缺少 API Key（Anthropic）")

    try:
        from anthropic import Anthropic
    except ImportError as exc:
        raise RuntimeError("未安装 anthropic SDK，请先执行: pip install anthropic") from exc

    client_kwargs: dict[str, Any] = {"api_key": api_key}
    base_url = settings.get("baseUrl")
    if base_url:
        client_kwargs["base_url"] = base_url

    client = Anthropic(**client_kwargs)
    model = settings.get("model") or "claude-opus-4-6-20250616"

    response = client.messages.create(
        model=model,
        max_tokens=16000,
        thinking={
            "type": "enabled",
            "budget_tokens": 8000,
        },
        messages=[{"role": "user", "content": prompt}],
    )

    parts = [block.text for block in response.content if getattr(block, "type", "") == "text"]
    content = "".join(parts).strip()
    if not content:
        raise RuntimeError("Anthropic API 返回为空")
    return content


def _call_openai_compatible(prompt: str, settings: dict[str, Any]) -> str:
    api_key = settings["apiKey"]
    if not api_key:
        raise RuntimeError(f"缺少 API Key（{settings.get('provider', 'openai')}）")

    try:
        from openai import OpenAI
    except ImportError as exc:
        raise RuntimeError("未安装 openai SDK，请先执行: pip install openai") from exc

    default_urls = {
        "openai": "https://api.openai.com/v1",
        "deepseek": "https://api.deepseek.com",
    }
    default_models = {
        "openai": "gpt-4o",
        "deepseek": "deepseek-chat",
    }

    provider = settings.get("provider", "openai")
    base_url = settings.get("baseUrl") or default_urls.get(provider, "https://api.openai.com/v1")
    model = settings.get("model") or default_models.get(provider, "gpt-4o")

    client = OpenAI(api_key=api_key, base_url=base_url)
    response = client.chat.completions.create(
        model=model,
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
    )

    content = response.choices[0].message.content
    if not content or not content.strip():
        raise RuntimeError(f"{provider} API 返回为空")
    return content.strip()


def call_ai(prompt: str, repo_root: Path) -> str:
    settings = load_ai_settings(repo_root)
    provider = settings.get("provider", "anthropic")
    if provider == "anthropic":
        return _call_anthropic(prompt, settings)
    else:
        return _call_openai_compatible(prompt, settings)
```

### 3.3 修改 `main()` 函数

将 `content = call_claude(prompt)` 改为 `content = call_ai(prompt, repo_root)`。

删除旧的 `call_claude()` 函数。

---

## 验证

1. `python3 -c "import ast; ast.parse(open('.scripts/auto_daily_plan.py').read())"` — 语法检查
2. 在 `.obsidian/plugins/kaoyan-countdown/` 目录下运行 `npm run build`（如果有 build 脚本）— 编译检查
3. 确认 `types.ts` 中 `DEFAULT_SETTINGS` 包含 `ai` 字段
4. 确认 `settingsTab.ts` 中有 `AI 模型配置` 标题
5. 确认 `auto_daily_plan.py` 中 `call_claude` 已被替换为 `call_ai`

完成后用 git 提交。
