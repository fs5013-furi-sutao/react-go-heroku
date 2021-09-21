# Docker を使って Go + React を Heroku にデプロイする：その２（データベース編）

今回は、このシリーズの [パート１](./README.PART.01.md) に続いて、
Heroku スタックにデータベースを追加していく。

最良の結果を得るためには、パート１の作業を完了させる。

## 構築するもの

パート1で作成したアプリを拡張し、/ping エンドポイントに
最後のリクエストからの期間を返す機能を追加する。

これにより、ping の間隔が長くなるほど値が大きくなる。
クライアントアプリケーションの変更はない。

## 必要なもの

前述のチュートリアルで説明したものと、ローカルの Postgres インスタンス（dockerをお勧めします）。

## Getting Started

まず、Postgres インスタンスをプロビジョニングする。
そのために、Docker から1つのインスタンスをプルダウンする。
なお、以下は1行で書いて実行する。

``` console
docker run -p 5432:5432 --name go-postgres -e POSTGRES_PASSWORD=mysecretpassword -d postgres
```

実行するとローカルに 5432 番ポートが利用可能な Postgres インスタンスが起動する。
それでは、このチュートリアルで使用するデータベースを作成してみる。

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

データベースを自由に使えるようになったので、
スキーマを up（必要に応じて down）マイグレーションするための堅牢な方法が必要となる。

理想的には、このロジックを自分で書きたくないので、
このチュートリアルでは、SQL および Go ベースのマイグレーションを指定する
優れた方法を備えた [Goose データベース移行ツール](https://github.com/pressly/goose) を使う。

> $ GOPATH/binディレクトリが $PATH にあることを確認すること

``` console
export PATH=$PATH:$(go env GOPATH)/bin

go get -u github.com/pressly/goose/cmd/goose
```

これで、好きな場所から goose バイナリを起動できるようになる。
ここでは、プロジェクトのルートにある migrations というディレクトリに
すべてのマイグレーションファイルを置いておく。

最初のマイグレーションを作成してみる。

``` console
mkdir ./migrations
goose -dir migrations create initial_seed sql
```

このコマンドを実行すると、/migrations ディレクトリに
タイムスタンプ付きの新しいファイルが作成される。

私的には 1つのマイグレーションファイルに
データベースへのマイグレーションの up/down するためのコマンドが
両方含まれていることが気に入っている。

作成されたマイグレーションファイルを開き、以下のように更新する。

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

それでは、プロジェクトのルートから実行してみる。なお、以下は1行で書いて実行する。

``` console
goose -dir migrations postgres "postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable" up
```

これを分解すると

- migrations ディレクトリにある migrations を実行するよう goose に指示
- ドライバーは postgres
- データベース接続文字列は postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable
- これでデータベースを up でマイグレーション

コンテナ内の psql ツールを使って、データベースがどのようになっているか見てみる。

``` console
docker exec -it -u postgres go-postgres psql

# "\c" は作成したデータベースに接続するコマンド
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

ご覧の通り、データベースには2つのテーブルが作成されているが、
ping_timestamp を作成するための SQL しか書いていない。

これは、goose がマイグレーションを1回しか実行しないことを保証するために独自のテーブルgoose_db_version を持っているためで、何度でも問題なくマイグレーションを行うことができる。

> down コマンドで再度 goose を実行し、
> ping_timestamp を削除できることも確認してみる

## API を拡張する

この API コードをデータベースに接続してみる。

そのためには、標準の database/sql パッケージと lib/pq postgres ドライバを使用する。
pg ドライバの ORM 機能については説明しない。

### main.go への追記

main.go サーバに2つの新しい関数を追加する。

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

追記した後、次のコマンドでパッケージを追加させておく。

``` console
go mod tidy
```

さて、ここではいくつかの点について説明する。
まず、main メソッドに注目する。

### DB のセットアップ

50行目は、私たちが [The Twelve-Factor App](https://12factor.net/ja/) の開発者として、
環境変数から DB の詳細を取得するところ。
`DATABASE_URL` は、Heroku がランタイムに注入して
データベースにアクセスするための標準的な変数名。

52行目では、標準の DB/SQL ライブラリを使用して、
pg データベースへの接続を作成している
（12行目のインポート時にドライバをロードしている）。

### アプリケーションロジック

さて、これでデータベースとのやり取りができるようになったが、
最後のリクエストからの経過時間を計算できるように、
簡単な ping のタイムスタンプを登録してみる。

新しい関数 pingFunc は、接続への参照を受け取り、2つのことを行う。

1. registerPing 関数の呼び出しを延期し、最終的に ping_timestamp テーブルに行を挿入して、この呼び出しが実行された時間を記録する。defer について詳しくは [こちら](https://tour.golang.org/flowcontrol/12) をご覧ください

2.  ping_timestamp から最新のエントリを選択し、経過時間を計算して、エンドユーザーに表示することがでる

### ローカル実行

これでアプリケーションをローカルで実行できる状態になった。
ここでもクライアントとサーバーを個別のターミナルウィンドウで起動する。

データベースの場所をプロセスに伝える必要があるので、
起動時に `DATABASE_URL` を環境に設定する。

``` console
# /server ディレクトリから実行
DATABASE_URL=postgres://postgres:mysecretpassword@localhost:5432/gotutorial?sslmode=disable go run main.go

# /client ディレクトリから実行
yarn start
```

1回目のリクエストでは「今回が初回アクセス」を、2回目のリクエストではデータを表示する。

![](./screencapture/02.run-it.png)

## Heroku へのデプロイ

これでローカル環境が整い、データベースを up/down マイグレーションすることができ、
クライアントとサーバーがうまく連携するようになった。

次に、Heroku CLI を使って、Heroku アプリに Postgres アドオンを
プロビジョニングしてみる。

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

これで、環境へのデータベースのプロビジョニングに成功したことが確認できる。

``` console
heroku addons

Add-on                                         Plan       Price  State
─────────────────────────────────────────────  ─────────  ─────  ───────
heroku-postgresql (postgresql-slippery-44382)  hobby-dev  free   created
 └─ as DATABASE

The table above shows add-ons and the attachments to the current app (blooming-hamlet-53782) or other apps.
```

新しいデータベースを正常に動作させるためには、
データベースのマイグレーションを実行する必要がある。
そのために、Heroku のリリースフェーズに接続する
（詳細は [こちら](https://devcenter.heroku.com/articles/release-phase)）。

基本的にリリースフェーズでは、コードがデプロイされる前に
データベースのマイグレーションなどを実行することができる。

> リリースフェーズのタスクが失敗した場合、新しいリリースはデプロイされず、
> 現在のリリースは影響を受けない

### リリースフェーズ

[パート１](./README.PART.01) の記事で、多段式の Docker ビルドを紹介した。

最初に作成したコンテナは、Go API を構築するために必要なものを
すべて備えたビルドコンテナ。
Heroku では、リリース時にこの中間コンテナを再利用することを選択した場合、
そのコンテナにフックすることができる。

まず、コンテナに goose がインストールされていることを確認するために、
Dockerfile を以下のように修正する。

``` dockerfile
# Go API をビルドする
FROM golang:latest AS builder
ADD . /app
WORKDIR /app/server
RUN go mod download
RUN go get -u github.com/pressly/goose/cmd/goose
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-w" -a -o /main .
```

次に、マイグレーションを実行するためのスクリプトを作成する。
/server ディレクトリに migrate.sh というファイルを以下の内容で作成する。

``` bash
#!/bin/sh

echo $DATABASE_URL
goose -dir ../migrations postgres $DATABASE_URL up
```

ここで `$DATABASE_URL` を参照していることに注目する。

これは main.go で同じ変数を使用していることと同じで、
Heroku がランタイムに注入して使用するための環境変数。
Heroku はリリース段階ですべての環境変数を利用できるようにしてくれるので、
それを利用することができる。

また、 ../migrations も参照している。
これは、プロジェクトのルートにこのディレクトリを作成し、
このコンテナの作業ディレクトリが /server であることを示している。

次のコマンドで実行可能な状態にする。

``` 
chmod +x ./migrate.sh
```

このコマンドを Dockerfile に追記しておく。

``` dockerfile
# Go API をビルドする
FROM golang:latest AS builder
ADD . /app
WORKDIR /app/server
RUN go mod download
RUN go get -u github.com/pressly/goose/cmd/goose
RUN chmod +x ./migrate.sh
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-w" -a -o /main .
```

このファイルを /server ディレクトリに追加することで、
Docker イメージで利用できるようになる
（Dockerfile の WORKDIR コマンドを参照）。

プロジェクトルートにある heroku.yml ファイルを更新することで、
どのようにマイグレーションしたいかを Heroku に伝えることができる。

heroku.yml は次のように更新する。

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

builder コンテナへの参照を作成していることに注目する。

このコンテキストでは、この worker を呼び出す。
これで、Heroku にこのコンテナにあるマイグレーションスクリプトを実行して、
リリースフェーズを完了するように伝えることができる。

それでは、Heroku にプッシュして動作を確認してみる。
そのためには、インスタンスのログを追跡できるように、
2つのターミナルを使うことを推奨する。

``` console
# すべての変更点を追加してコミットし、プッシュ
git add .
git commit -m 'Adding database support'
git push origin main
git push heroku main

# 新しいターミナルで、コンテナのログを追跡
heroku logs --tail
```

うまくいけば、それぞれのターミナルウィンドウに面白いものが表示されるはず。
リリースが完了したら、本番サイトに移動して、数字が上がっていくのを見てみる。

> ヒント: 
> $ heroku apps:info を使って、プロダクションの URL などを確認する

![](./screencapture/03.release-phase.png)

### A5M2 への接続方法

アプリに追加した add-on である Heroku Postgres:Hobby Dev の接続情報は、
Heroku サイトのダッシュボードから確認できる。

接続情報を見るには、ダッシュボードの Resources の Add-ons 一覧から対象のアドオンを選択。
別タブが開き、Settings を開き Database Credentials の「View Credentials...」ボタンをクリックすると
接続情報を見ることができる。

![](./screencapture/04.heroku-db-credentials.png)

A5M2 の接続情報に必要なのは、「Host」「Database」「User」「Port」「Password」の項目。

![](./screencapture/05.a5m2-connect-settings.png)

これを A5m2 に設定し、「SSLモード」は「優先（SSL接続を優先）」にする。

![](./screencapture/06.a5m2-ssl-settings.png)

これで Heroku Postgres:Hobby Dev のテーブルのデータを見ることができる。

![](./screencapture/07.a5m2-show-table.png)

## まとめ

おめでとう。
これで Postgres にデータを保存できるアプリケーションができた。

これは素晴らしい第2段階。
先に進み、データベースのマイグレーションやデータベース的なことで遊んでみてください。
データベースを up マイグレーションしてみたり、
また down マイグレーションしてみたりして、その挙動を見てみるなど、
ぜひやってみてください。