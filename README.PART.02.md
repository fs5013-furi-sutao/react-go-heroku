# Docker を使って Go + React を Heroku にデプロイする：その２（データベース編）

今回は、このシリーズの [パート１](./README.PART.01.md) に続いて、
Heroku スタックにデータベースを追加していきます。

最良の結果を得るためには、パート１を完了させるか、
少なくともここからコードをチェックアウトして環境を整える必要があります。
完成したソリューションは、レポの database ブランチにあります。

## 構築するもの

パート1で作成したアプリを拡張し、/ping エンドポイントに
最後のリクエストからの期間を返す機能を追加します。

これにより、ping の間隔が長くなるほど値が大きくなります。
クライアントアプリケーションの変更はありません。

## 必要なもの

前述のチュートリアルで説明したものと、ローカルの Postgres インスタンス（dockerをお勧めします）。

## Getting Started

まず、Postgres インスタンスをプロビジョニングしましょう。
そのために、dockerから1つのインスタンスをプルダウンします。
なお、以下は1行です。

``` console
docker run -p 5432:5432 --name go-postgres -e POSTGRES_PASSWORD=mysecretpassword -d postgres
```

これで、ローカルで 5432 番ポートが利用可能な Postgres インスタンスが起動しました。
それでは、このチュートリアルで使用するデータベースを作成してみましょう。

``` console
# コンテナに postgres ユーザでログインし、psql を起動
docker exec -it -u postgres go-postgres psql

# create コマンドでデータベースを作成
create database gotutorial;

# psql とコンテナから出る
\q

# これでターミナルに戻っているはず
```

A5M2 には次の情報で接続可能になる。

- サーバー名: localhost
- データベース名: gotutorial
- ユーザーID: postgres
- パスワード: mysecretpassword
  
## データベースのマイグレーション

データベースを自由に使用できるようになったので、
スキーマを上に（必要に応じて下に）移行するための堅牢な方法が必要です。

理想的には、このロジックを自分で記述したくないので、このチュートリアルでは、SQLおよびGoベースの移行を指定する優れた方法を備えたGooseデータベース移行ツールについて説明しました。

データベースを自由に使えるようになったので、
スキーマを上に（必要に応じて下に）移行するための堅牢な方法が必要です。

理想的には、このロジックを自分で書きたくないので、このチュートリアルでは、
SQL と Go ベースの移行を指定する優れた方法を
備えた [Goose データベース移行ツール](https://github.com/pressly/goose) を見てみました。

> $ GOPATH/binディレクトリが $PATH にあることを確認してください

``` console
export PATH=$PATH:$(go env GOPATH)/bin

go get -u github.com/pressly/goose/cmd/goose
```

これで、好きな場所から goose バイナリを起動できるようになります。
ここでは、プロジェクトのルートにある migrations というディレクトリに
すべてのマイグレーションを置いておきましょう。

最初のマイグレーションを作成してみましょう。

``` console
mkdir ./migrations
goose -dir migrations create initial_seed sql
```

このコマンドを実行すると、/migrations ディレクトリに
タイムスタンプ付きの新しいファイルが作成されます。

私は、1つのマイグレーションファイルに
データベースへのマイグレーションの up/down するためのコマンドが
両方含まれていることが気に入っています。

作成されたマイグレーションファイルを開き、以下のように更新します。

``` sql
-- +goose Up
-- このセクションの SQL はマイグレーションが適用されたときに実行される
CREATE TABLE ping_timestamp (
    id SERIAL,
    occurred TIMESTAMPTZ NOT NULL
);

-- +goose Down
-- このセクションのSQLは、マイグレーションがロールバックされたときに実行されます。
DROP TABLE ping_timestamp;
```

それでは、プロジェクトのルートから実行してみましょう。なお、以下は1行です。

``` console
goose -dir migrations postgres "postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable" up
```

これを分解すると

- migrations ディレクトリにある migrations を実行するよう goose に指示
- ドライバは postgres
- データベース接続文字列は postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable
- それでデータベースを up でマイグレーション

コンテナ内の psql ツールを使って、データベースがどのようになっているか見てみましょう。

``` console
docker exec -it -u postgres go-postgres psql

# "\c" は作成したデータベースに接続します
postgres=# \c gotutorial
You are now connected to database "gotutorial" as user "postgres".

gotutorial=# \dt
              List of relations
 Schema |       Name       | Type  |  Owner
--------+------------------+-------+----------
 public | goose_db_version | table | postgres
 public | ping_timestamp   | table | postgres
(2 rows)

gotutorial=# \q
```

ご覧の通り、データベースには2つのテーブルが作成されていますが、
ping_timestamp を作成するための SQL しか書いていません。

これは、goose がマイグレーションを1回しか実行しないことを保証するために独自のテーブルgoose_db_version を持っているためで、何度でも問題なくマイグレーションを行うことができます。

> down コマンドで再度 goose を実行し、
> ping_timestamp を削除できることも確認してください

## API を拡張する

この API コードをデータベースに接続してみましょう。

そのためには、標準の database/sql パッケージと lib/pq postgres ドライバを使用します。
pg ドライバの ORM 機能については説明しませんが、見て何を考えるかは自由です。

### main.go への追記

main.go サーバに2つの新しい関数を追加します。

``` go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/gin-gonic/contrib/static"
	"github.com/gin-gonic/gin"
	pq "github.com/lib/pq"
)

func registerPing(db *sql.DB) {

	_, err := db.Exec("INSERT INTO ping_timestamp (occurred) VALUES ($1)", time.Now())
	if err != nil {
		log.Println("Couldn't insert the ping")
		log.Println(err)
	}
}

func pingFunc(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {

		defer registerPing(db)
		r := db.QueryRow("SELECT occurred FROM ping_timestamp ORDER BY id DESC LIMIT 1")
		var lastDate pq.NullTime
		r.Scan(&lastDate)

		message := "first time!"
		if lastDate.Valid {
			message = fmt.Sprintf("%v ago", time.Now().Sub(lastDate.Time).String())
		}

		c.JSON(200, gin.H{
			"message": message,
		})
	}
}

func main() {

	r := gin.Default()

	// Webからの静的コンテンツの提供 - dockerコンテナ内で生成
	r.Use(static.Serve("/", static.LocalFile("./web", true)))

	api := r.Group("/api")
	dbUrl := os.Getenv("DATABASE_URL")
	log.Printf("DB [%s]", dbUrl)
	db, err := sql.Open("postgres", os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatalf("Error opening database: %q", err)
	}
	log.Println("booyah")
	api.GET("/ping", pingFunc(db))

	r.Run()
}
```

さて、ここではいくつかの点について説明します。
まず、main メソッドに注目しましょう。

### DB のセットアップ

50行目は、私たちが [The Twelve-Factor App](https://12factor.net/ja/) の開発者として、
環境変数から DB の詳細を取得するところです。
`DATABASE_URL` は、Heroku がランタイムに注入して
データベースにアクセスするための標準的な変数名です。

52行目では、標準の DB/SQL ライブラリを使用して、
pg データベースへの接続を作成しています
（12行目のインポート時にドライバをロードしています）。

### アプリケーションロジック

さて、これでデータベースとのやり取りができるようになりましたが、
最後のリクエストからの経過時間を計算できるように、
簡単な ping のタイムスタンプを登録してみましょう。

新しい関数 pingFunc は、接続への参照を受け取り、2つのことを行います。

1. registerPing 関数の呼び出しを延期し、最終的に ping_timestamp テーブルに行を挿入して、この呼び出しが実行された時間を記録します。defer について詳しくは [こちら](https://tour.golang.org/flowcontrol/12) をご覧ください

2.  ping_timestamp から最新のエントリを選択し、経過時間を計算して、エンドユーザーに表示することができます

### ローカル実行

これでアプリケーションをローカルで実行できる状態になりました。
ここでもクライアントとサーバーを個別のターミナルウィンドウで起動します。

データベースの場所をプロセスに伝える必要があるので、
起動時に `DATABASE_URL` を環境に設定します。

``` console
# /server ディレクトリから実行
DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable go run main.go

# /client ディレクトリから実行
yarn start
```

2回目のリクエストでは「first time!」を、2回目のリクエストではデータを表示します。

![](./screencapture/02.run-it.png)

## Heroku へのデプロイ

これでローカル環境が整い、データベースを up/down マイグレーションすることができ、
クライアントとサーバーがうまく連携するようになりました。

次に、Heroku CLI を使って、Heroku アプリに Postgres アドオンを
プロビジョニングしてみましょう。

``` console
# root ディレクトリで実行
heroku addons:create heroku-postgresql:hobby-dev

Creating heroku-postgresql:hobby-dev on ⬢ blooming-hamlet-53782... free
Database has been created and is available
 ! This database is empty. If upgrading, you can transfer
 ! data from another database with pg:copy
Created postgresql-slippery-44382 as DATABASE_URL
Use heroku addons:docs heroku-postgresql to view documentation
```

これで、環境へのデータベースのプロビジョニングに成功したことが確認できます。

``` console
heroku addons

Add-on                                         Plan       Price  State
─────────────────────────────────────────────  ─────────  ─────  ───────
heroku-postgresql (postgresql-slippery-44382)  hobby-dev  free   created
 └─ as DATABASE

The table above shows add-ons and the attachments to the current app (blooming-hamlet-53782) or other apps.
```

新しいデータベースを正常に動作させるためには、
データベースのマイグレーションを実行する必要があります。
そのために、Heroku のリリースフェーズに接続します
（詳細は [こちら](https://devcenter.heroku.com/articles/release-phase)）。

基本的にリリースフェーズでは、コードがデプロイされる前に
データベースのマイグレーションなどを実行することができます。

> リリースフェーズのタスクが失敗した場合、新しいリリースはデプロイされず、
> 現在のリリースは影響を受けません。

### リリースフェーズ

[パート１](./README.PART.01) の記事で、多段式の Docker ビルドをご紹介しました。

最初に作成するコンテナは、Go API を構築するために必要なものを
すべて備えたビルドコンテナです。
Heroku では、リリース時にこの中間コンテナを再利用することを選択した場合、
そのコンテナにフックすることができます。

まず、コンテナに goose がインストールされていることを確認するために、
Dockerfile を以下のように修正します。

``` dockerfile
# Go API をビルドする
FROM golang:latest AS builder
ADD . /app
WORKDIR /app/server
RUN go mod download
RUN go get -u github.com/pressly/goose/cmd/goose
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-w" -a -o /main .
```

次に、マイグレーションを実行するためのスクリプトを作成します。
/server ディレクトリに migrate.sh というファイルを以下の内容で作成します。

``` bash
#!/bin/sh

echo $DATABASE_URL
goose -dir ../migrations postgres $DATABASE_URL up
```

ここで `$DATABASE_URL` を参照していることに注目してください。

これは main.go で同じ変数を使用していることと同じです。
これは、Heroku がランタイムに注入して使用するための環境変数です。
Heroku はリリース段階ですべての環境変数を利用できるようにしてくれるので、
それを利用することができます。

また、 ../migrations も参照しています。
これは、プロジェクトのルートにこのディレクトリを作成し、
このコンテナの作業ディレクトリが /server であることを示しています。

次のコマンドで実行可能な状態にする。

``` console
chmod +x ./migrate.sh
```

このファイルを /server ディレクトリに追加することで、
Docker イメージで利用できるようになります
（Dockerfile の WORKDIR コマンドを参照）。

プロジェクトルートにある heroku.yml ファイルを更新することで、
どのようにマイグレーションしたいかを Heroku に伝えることができます。

次のように更新してください。

``` yaml
build:
  docker:
    web: Dockerfile
    worker:
       dockerfile: Dockerfile
       target: builder    
release:
  image: worker
  command:
    - ./migrate.sh
```

builder コンテナへの参照を作成していることに注目してください。

このコンテキストでは、このワーカーを呼び出します。
これで、Heroku にこのコンテナにあるマイグレーションスクリプトを実行して、
リリースフェーズを完了するように伝えることができます。

それでは、Heroku にプッシュして動作を確認してみましょう。
このためには、インスタンスのログを追跡できるように、
2つのターミナルを使うことをお勧めします。

``` console
# すべての変更点を追加してコミットし、プッシュ
git add .
git commit -m 'Adding database support'
git push origin main
git push heroku main

# 新しいターミナルで、コンテナのログを追跡
heroku logs --tail
```

うまくいけば、それぞれのターミナルウィンドウに面白いものが表示されるはずです。リリースが完了したら、本番サイトに移動して、数字が上がっていくのを見てみましょう。

> ヒント: 
> $ heroku apps:info を使って、プロダクションの URL などを確認してください

## まとめ

ここまで来れておめでとうございます。
これで Postgres にデータを保存できるアプリケーションができました。

これは素晴らしい第2段階です。
先に進み、データベースの移行やデータベース的なことで遊んでみてください。
データベースを up マイグレーションしてみたり、
また down マイグレーションしてみたりして、その挙動を見てみましょう。
ぜひやってみてください。