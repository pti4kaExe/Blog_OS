# Перезапись истории BlogOS: убрать из всех коммитов объекты кэша npm,
# которые попали в первые коммиты и раздули .git до 79 МБ.
#
# filter-branch в этой среде не работает (shell-скрипт не может создать pipe),
# поэтому история пересобирается штатными командами git:
#   read-tree → rm --cached → write-tree → commit-tree
# Сообщения, авторы и даты коммитов сохраняются, меняются только хеши.

$ErrorActionPreference = 'Stop'
Set-Location 'D:\Документы\BlogOS'

$exclude = @('.npm-cache', '_scratch', '.pglite-data', 'apps/api/dist', 'apps/web/dist')

$commits = @(git rev-list --reverse HEAD)
Write-Host "коммитов в истории: $($commits.Count)"

$tmpDir = Join-Path $env:TEMP ('blogos-history-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null
$env:GIT_INDEX_FILE = Join-Path $tmpDir 'index'

$prev = $null
$newHead = $null
$kept = 0
$dropped = 0

foreach ($commit in $commits) {
    git read-tree "$commit^{tree}"
    git rm -r --cached -f --ignore-unmatch -q @exclude 2>$null | Out-Null
    $tree = (git write-tree).Trim()

    if ($prev) {
        $parentTree = (git rev-parse "$prev^{tree}").Trim()
        if ($parentTree -eq $tree) {
            Write-Host "  - $commit пропущен: после чистки изменений не осталось"
            $dropped++
            continue
        }
    }

    $an = (git show -s --format=%an $commit).Trim()
    $ae = (git show -s --format=%ae $commit).Trim()
    $aI = (git show -s --format=%aI $commit).Trim()
    $cn = (git show -s --format=%cn $commit).Trim()
    $ce = (git show -s --format=%ce $commit).Trim()
    $cI = (git show -s --format=%cI $commit).Trim()

    $msgFile = Join-Path $tmpDir "msg-$commit.txt"
    # UTF-8 без BOM: иначе BOM попадёт в текст сообщения коммита.
    $msgText = ((git show -s --format=%B $commit) -join "`n") + "`n"
    [System.IO.File]::WriteAllText($msgFile, $msgText, (New-Object System.Text.UTF8Encoding($false)))

    $env:GIT_AUTHOR_NAME = $an
    $env:GIT_AUTHOR_EMAIL = $ae
    $env:GIT_AUTHOR_DATE = $aI
    $env:GIT_COMMITTER_NAME = $cn
    $env:GIT_COMMITTER_EMAIL = $ce
    $env:GIT_COMMITTER_DATE = $cI

    $commitArgs = @('commit-tree', $tree)
    if ($prev) { $commitArgs += @('-p', $prev) }
    $newCommit = (git @commitArgs -F $msgFile).Trim()

    Write-Host "  + $commit → $newCommit  $((git show -s --format=%s $commit).Trim())"
    $prev = $newCommit
    $newHead = $newCommit
    $kept++
}

Remove-Item Env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
foreach ($name in 'GIT_AUTHOR_NAME','GIT_AUTHOR_EMAIL','GIT_AUTHOR_DATE','GIT_COMMITTER_NAME','GIT_COMMITTER_EMAIL','GIT_COMMITTER_DATE') {
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

Write-Host "оставлено коммитов: $kept, пропущено пустых: $dropped"
Write-Host "новый HEAD: $newHead"

git update-ref refs/heads/master $newHead
git reset --hard master | Out-Null
git branch -M main

if (Test-Path .git\refs\original) { Remove-Item -Recurse -Force .git\refs\original }
git reflog expire --expire=now --all 2>$null
git gc --prune=now 2>$null

Write-Host '--- итог ---'
git log --oneline --decorate
git count-objects -vH | Select-String 'size:'
