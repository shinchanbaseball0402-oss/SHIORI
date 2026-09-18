# わが家の掲示板 (SHIORI)

家族専用の掲示板サイト。ログイン不要、URLを知っている家族だけが読み書きできます。
1つのURL(`?b=xxxxx`)が1家族分の掲示板に対応します。

## 使われている技術

- 素のHTML/CSS/JavaScript(ビルド不要。ブラウザでそのまま動きます)
- データ保存:[Firebase](https://firebase.google.com/) Firestore(投稿・コメント)+ Storage(写真)
- 公開先:GitHub Pages(想定)

## セットアップ手順

### 1. Firebaseプロジェクトを作る

1. https://console.firebase.google.com を開き、Googleアカウントでログイン
2. 「プロジェクトを追加」→ プロジェクト名を入力(例:`shiori`)→ 作成
3. 左メニュー「構築」→「Firestore Database」→「データベースの作成」
   - ロケーションは `asia-northeast1`(東京)を推奨
   - ルールは後で `firestore.rules` の内容に置き換えるので、とりあえず「テストモードで開始」でOK
4. 左メニュー「構築」→「Storage」→「開始する」
   - 同様に「テストモードで開始」でOK
5. 左メニュー「プロジェクトの概要」の横の歯車アイコン →「プロジェクトの設定」→「全般」タブを一番下までスクロール
6. 「マイアプリ」で「</>」(ウェブ)アイコンをクリックしてアプリを登録(アプリ名は何でもOK、Firebase Hostingの設定は不要なのでチェックを外してOK)
7. 表示された `firebaseConfig` の中身を、このプロジェクトの `firebase-config.js` にコピペする

```js
const firebaseConfig = {
  apiKey: "実際の値",
  authDomain: "実際の値",
  projectId: "実際の値",
  storageBucket: "実際の値",
  messagingSenderId: "実際の値",
  appId: "実際の値",
};
```

### 2. セキュリティルールを適用する

Firestore Database の「ルール」タブを開き、`firestore.rules` の中身を貼り付けて公開。
Storage の「ルール」タブも同様に `storage.rules` の中身を貼り付けて公開。

(今はアカウント制度がないため「URLを知っていれば誰でも読み書きできる」というゆるいルールです。将来アカウントを導入したら、ここを絞ります。)

### 3. 動作確認

`index.html` をブラウザで直接開く(ダブルクリックでOK、サーバー不要)。
初回アクセス時に自動でURLの末尾に `?b=ランダムな文字列` が付き、その掲示板が作られます。
「思い出」に何か投稿してみて、ちゃんと保存・表示されれば成功です。

### 4. GitHubにpushする

GitHubで空のリポジトリを1つ作成してから(READMEなどは追加しない、完全に空の状態)、このフォルダで:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
git push -u origin main
```

### 5. GitHub Pagesで公開する

1. GitHubのリポジトリページ →「Settings」→左メニュー「Pages」
2. 「Build and deployment」の「Source」を `Deploy from a branch` に
3. 「Branch」を `main` / `/ (root)` にして「Save」
4. 数分待つと `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます

これが「わが家の掲示板」の本番URLです。家族に配るときは、末尾に `?b=xxxxx` を付けたURL(各家族ごとに違うもの)を渡してください。何も付けずにアクセスすると、新しい掲示板が自動で作られます。

## 今後の拡張(フェーズ2以降のメモ)

- 今は誰でも新しい掲示板を作れてしまうので、悪用防止や一覧管理を考えるなら `boards` コレクションを見て運用側で棚卸しする
- 課金(スタンダード550円・コンシェルジュ1,100円・フォトブック2,000円)を導入する際はStripeを追加し、`boards/{boardId}` に `plan` フィールドを持たせて容量やコメント数などを制限する
- アカウント制度を入れる際は、Firebase Authenticationを追加し、`firestore.rules` の `allow write: if true` を管理者チェックに差し替える
