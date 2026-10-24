<#
.SYNOPSIS
    Публикация BlogOS на GitHub одной командой.

.DESCRIPTION
    Что делает скрипт:
      1. проверяет, что репозиторий чистый и находится в корне проекта;
      2. ставит локальную подпись коммитов: <Account> и <Account>@users.noreply.github.com
         (настоящий email автора не публикуется);
      3. переписывает автора и committer'а во всех коммитах на эту подпись,
         сохраняя сообщения и даты; хеши коммитов меняются — это нормально,
         репозиторий ещё никуда не отправлялся;
      4. добавляет remote origin (https://github.com/<Account>/<Repo>.git),
         включает HTTPS-бэкенд openssl (в этой среде schannel не работает);
      5. делает push -u origin main. При первом push Windows Credential Manager
         откроет браузер для входа в GitHub — токен вводить не нужно.

    Репозиторий на GitHub нужно создать заранее: пустой, без README,
    .gitignore и лицензии (иначе первый push отклонится как non-fast-forward).

.PARAMETER Account
    Логин GitHub, например ivan-dev.

.PARAMETER Repo
    Имя репозитория. По умолчанию blogos.

.PARAMETER Name
    Отображаемое имя автора коммитов. По умолчанию равно логину.

.PARAMETER SkipPush
    Только подготовить (подпись, автор, remote), без push. Для проверки.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance\push-to-github.ps1 -Account ivan-dev

.EXAMPLE
    # другое имя репозитория и своё отображаемое имя
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\maintenance\push-to-github.ps1 -Account ivan-dev -Repo blogos-mvp -Name "Иван Петров"
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Account,

    [string]$Repo = 'blogos',
    [string]$Name = '',
    [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'

function Fail($message) {
    Write-Host "ОШИБКА: $message" -ForegroundColor Red
    exit 1
}

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root
if (-not (Test-Path (Join-Path $root '.git'))) { Fail "не найден .git в $root" }

if (-not $Name) { $Name = $Account }
$email = "$Account@users.noreply.github.com"
$remoteUrl = "https://github.com/$Account/$Repo.git"

Write-Host "Проект:  $root"
Write-Host "Аккаунт: $Account"
Write-Host "Репозиторий: $remoteUrl"
Write-Host "Подпись: $Name <$email>"
Write-Host ''

# ─── 1. Чистое дерево ────────────────────────────────────────────────────────
$dirty = git status --porcelain
if ($dirty) {
    Fail ("в рабочей копии есть незакоммиченные изменения:`n" + ($dirty -join "`n") + "`nСначала закоммитьте их или уберите.")
}

# ─── 2. Локальная подпись ────────────────────────────────────────────────────
git config user.name $Name
git config user.email $email
git config http.sslBackend openssl
Write-Host 'подпись коммитов настроена'

# ─── 3. Переписать автора во всех коммитах ───────────────────────────────────
$commits = @(git rev-list --reverse HEAD)
Write-Host "коммитов в истории: $($commits.Count)"

$prev = $null
$newHead = $null
$tmpDir = Join-Path $env:TEMP ('blogos-push-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

foreach ($commit in $commits) {
    $tree = (git rev-parse "$commit^{tree}").Trim()
    $authorDate = (git show -s --format=%aI $commit).Trim()
    $committerDate = (git show -s --format=%cI $commit).Trim()

    $msgFile = Join-Path $tmpDir "msg-$commit.txt"
    $msgText = ((git show -s --format=%B $commit) -join "`n") + "`n"
    [System.IO.File]::WriteAllText($msgFile, $msgText, (New-Object System.Text.UTF8Encoding($false)))

    $env:GIT_AUTHOR_NAME = $Name
    $env:GIT_AUTHOR_EMAIL = $email
    $env:GIT_AUTHOR_DATE = $authorDate
    $env:GIT_COMMITTER_NAME = $Name
    $env:GIT_COMMITTER_EMAIL = $email
    $env:GIT_COMMITTER_DATE = $committerDate

    $commitArgs = @('commit-tree', $tree)
    if ($prev) { $commitArgs += @('-p', $prev) }
    $newCommit = (git @commitArgs -F $msgFile).Trim()

    $prev = $newCommit
    $newHead = $newCommit
    Write-Host "  + $($commit.Substring(0, 7)) → $($newCommit.Substring(0, 7))  $((git show -s --format=%s $commit).Trim())"
}

foreach ($var in 'GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_AUTHOR_DATE','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','GIT_COMMITTER_DATE') {
    Remove-Item "Env:$var" -ErrorAction SilentlyContinue
}
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue

git update-ref refs/heads/main $newHead
git symbolic-ref HEAD refs/heads/main
git reset --hard main | Out-Null
if (Test-Path .git\refs\original) { Remove-Item -Recurse -Force .git\refs\original }
git reflog expire --expire=now --all 2>$null
git gc --prune=now 2>$null
Write-Host 'автор коммитов переписан'

# ─── 4. Remote ───────────────────────────────────────────────────────────────
$existing = git remote
if ($existing -contains 'origin') {
    git remote set-url origin $remoteUrl
    Write-Host 'remote origin обновлён'
} else {
    git remote add origin $remoteUrl
    Write-Host 'remote origin добавлен'
}

if ($SkipPush) {
    Write-Host ''
    Write-Host 'Готово (push пропущен по -SkipPush). Проверить: git log --oneline; git remote -v'
    exit 0
}

# ─── 5. Push ─────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host 'Отправляю на GitHub. Если откроется окно входа — войдите в аккаунт.'
$env:GIT_TERMINAL_PROMPT = '1'
git push -u origin main
$code = $LASTEXITCODE
Remove-Item Env:GIT_TERMINAL_PROMPT -ErrorAction SilentlyContinue

if ($code -ne 0) {
    Write-Host ''
    Write-Host "push не удался (код $code). Частые причины:" -ForegroundColor Yellow
    Write-Host "  • репозиторий $remoteUrl ещё не создан на GitHub;"
    Write-Host '  • в репозитории уже есть README/лицензия — тогда: git pull --rebase origin main, затем повторить push;'
    Write-Host '  • вход отменён или нет прав на аккаунт.'
    Write-Host 'Повторить: git push -u origin main'
    exit $code
}

Write-Host ''
Write-Host "Готово: https://github.com/$Account/$Repo" -ForegroundColor Green
git log --oneline -3
