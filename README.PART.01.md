# Docker を使って Go + React を Heroku にデプロイする：その１

## 構築するもの 

React でクライアントを、Go でサーバーを構築し、
Docker を使って Heroku にデプロイする。また、開発に必要なローカル環境も用意する。

## 必要なもの

作業を始めるにあたり、以下のツールが必要となる。

- Node.js（クライアント）
- Go（サーバー）
- Docker（デプロイのため）
- ホストとしての Heroku (無料アカウント、CLI ツール)
- IDE (VSCode)

## Getting started 

ルートディレクトリには、client と server の別々のディレクトリを作成し、
ルートには最終プロダクトを構築するための Dockerfile（これはディレクトリではなくファイル）も
格納する。

``` 
project
  |
  |-client/
  |-server/
  Dockerfile
```

## Go サーバー

まず最初に、フロントエンドが利用するための APIを作成する。
/server ディレクトリで新しい Go モジュールを作成し、最初の main.go ファイルを作成する。

環境は Windows 10 でコマンドラインツールは Git Bash を使う想定。

``` console
cd /c/Users/＜ユーザ名＞/Desktop/
mkdir ./react-go-heroku
cd ./react-go-heroku/
mkdir ./server
cd ./server
```

mod ファイルを作成。

``` console
go mod init github.com/＜自分の GitHub のユーザ名＞/react-go-heroku
```

まずは２つのモジュールを import する。

``` console
go get github.com/gin-gonic/contrib/static
go get github.com/gin-gonic/gin
```

main.go の内容は以下の通り。

``` go
package main

import (
	"github.com/gin-gonic/contrib/static"
	"github.com/gin-gonic/gin"
)

func main() {

	r := gin.Default()

	// この行はまだ気にしない、Dockerise の部分で意味が分かる
	r.Use(static.Serve("/", static.LocalFile("./web", true)))
	
  api := r.Group("/api")
	api.GET("/ping", func(c *gin.Context) {
		c.JSON(200, gin.H{
			"message": "pong",
		})
	})

	r.Run()
}
```

ここでは、ルーティングを支援するために人気のある Web フレームワーの gin を使用する。

アプリの動作は以下のコマンドで確認する。

``` console
go run main.go

# このコマンドは新しい Git Bash で実行する
curl localhost:8080/api/ping
```

## Getting started with React

> 免責事項：
> ここで生成されたコードは、React および create-react-app の進化にともなって
> 変更される可能性がある

Facebook の create-react-app ツールを利用すれば、
フロントエンドをすばやくスキャフォールディングできる。

プロジェクトのルートディレクトリにジャンプして、次のコマンドを実行する。

``` console
npx create-react-app client
```

> モノリポジトリを作成しているので、新しく作成した /client ディレクトリ
> にある git リポジトリ（.git）は削除する

### PingComponent

サーバーにアクセスできるコンポーネントを作成する。
この場合、API 呼び出しを行うのに役立つ一般的なフレームワーク
である axios を使用する。

以下のファイルを React アプリの src ディレクトリに配置する。
このファイルを `PingComponent.js` と呼ぶ。

このコードを使う前に、axios パッケージをインポートする必要がある。

``` console
# /client ディレクトリから実行する
yarn add axios
```

PingComponent.js のコードは以下の通り。

``` js
import React, { Component } from 'react'
import axios from 'acios'

class PingComponent extends Component {

    constructor() {
        super()
        this.state = {
            pong: 'pending'
        }
    }

    componentWillMount() {
        axios.get('api/ping')
            .then((response) => {
                this.setState(() => {
                    return { pong: response.data.message }
                })
            })
            .catch(function (error) {
                console.log(error)
            })
    }

    render() {
        return <h1>Ping {this.state.pong}</h1>
    }
}

export default PingComponent
```

13行目で api/ping のエンドポイントを起動していることに注目してください。
yarn start を使って React アプリを起動すると、
これは http://localhost:3000/api/ping に相当する。

### App.js

それでは、可能な限りシンプルな方法で ping コンポーネントを接続してみる。
create-react-app ツールで作成した App.js ファイルに、以下を追加する。

``` js
import logo from './logo.svg'
import './App.css'
import PingComponent from './PingComponent'

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Docker を使って React + Go アプリを Heroku にデプロイ
        </p>
        <PingComponent />

      </header>
    </div>
  );
}

export default App;
```

4行目と23行目に注目してください。ここでは、PingComponent をインポートして使用している。

### ローカル開発のための Proxy

仮に両方のコードベースを起動すると、クライアントが 3000 番ポートで、
サーバーが 8080 番ポートで動作している。
これは開発にとって理想的ではない。

そこで、package.json に proxy フィールドを追加、修正することで、
未知のリクエストをすべて API サーバーにプロキシするように
クライアントを設定することができる。

``` json
"proxy": "http://localhost:8080"
```

## ローカルでの実行

さて、これでサーバーと、リクエストをプロキシする機能を持つクライアントができた。
それでは早速試してみる。

ターミナルを開いて、まずサーバーを起動し（まだ起動していなければ）、
次にクライアントを yarn start で起動する。

これで自動的にブラウザでアプリが開かれ、成功が確認できるはず。

![](./screencapture/01.running-locally.png)

## Docker

これで開発環境が整ったので、これを「prod」にしてみる。

### Dockerfile

まず、本番コードをホストする Docker コンテナを作成する。

これは実行可能な Go プログラムと、React アプリケーションの
プロダクションビルドとなる。
このためにマルチステージの Docker ビルドを使用することができ、
プロジェクトのルートにある Dockerfile というファイルにこのテキストを貼り付ける。

``` dockerfile
# Go API をビルドする
FROM golang:latest AS builder
ADD . /app
WORKDIR /app/server
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "-w" -a -o /main .

# React アプリをビルドする
FROM node:alpine AS node_builder
COPY --from=builder /app/client ./
RUN npm install
RUN npm run build

# 最終段階のビルドで、
# これが本番環境にデプロイされるコンテナ
FROM alpine:latest
RUN apk --no-cache add ca-certificates
COPY --from=builder /main ./
COPY --from=node_builder /build ./web
RUN chmod +x ./main
EXPOSE 8080
CMD ./main
```

ここでは、3つの Docker コンテナを作成している。
1つ目は Go API を構築するため、2つ目は React アプリケーションを
構築するため、そして3つ目は本番コードのみを格納する軽量コンテナを作成している。

> ここでのちょっとしたコツは、`.dockerignore` ファイルを作成して、
> 不要なファイルを docker コンテキストにプッシュしないようにすること。
> 今回のケースでは、client/node_modules ファイルが非常に大きなサイズになっている。
> そこで、このファイルを .dockerignore ファイルに追加する。

``` console
echo '**/node_modules' > ./.dockerignore
```

### Dockerコンテナの実行

``` console 
docker build -t golang-heroku .
docker run -p 3000:8080 -d golang-heroku
```

docker build で golang-heroku というタグのついたイメージが作成されるので、
run コマンドでこのイメージのインスタンスを実行することができる。

docker run コマンドは、ローカルの 3000 番ポートを
コンテナ内の 8080 番ポートに転送していることに注意する。

これで、ローカルで作業内容を確認することができる。

http://localhost:3000 にアクセスして、自分のウェブサイトを見てみる。

#### Docker プロセスの確認方法

docker ps コマンドを実行することで、すべてのプロセスのステータスが一覧表示される。

``` console
docker ps
```

コンテナID のみを表示させたい場合は `-q` オプションを付ける。

``` console
docker ps -q
```

#### Docker プロセスの停止方法

docker stop コマンドに、対象コンテナのコンテナIDを指定して実行することで、
対象コンテナを停止させることができる。

``` console
docker stop ＜コンテナID＞
```

起動しているコンテナが１つしかない場合は、
コマンドを組み合わせて次のようにコンテナを停止させることもできる。

``` console
docker stop `docker ps -q`
```

#### 停止している Docker プロセスの確認方法

docker ps コマンドに `-a` オプションを付ければ、
停止中のプロセスのステータスを一覧表示させることができる。

``` console
docker ps -a
```

コンテナID のみを表示させたい場合は `-q` オプションを付け加える。

``` console
docker ps -aq
```

#### Docker プロセスの削除方法

docker rm コマンドに、対象コンテナのコンテナIDを指定して実行することで、
対象コンテナを削除することができる。

``` console
docker rm ＜コンテナID＞
```

#### Docker イメージの表示方法

docker images コマンドを実行することで、
保管している Docker イメージのステータスを一覧表示できる。

``` console 
docker images
```

#### Docker イメージの削除方法

docker rmi コマンドに、対象コンテナのコンテナIDを指定して実行することで、
対象コンテナのイメージを削除することができる。

``` console
docker rmi ＜コンテナID＞
```

## Heroku

これで、Heroku に提供したいものをローカルでビルドすることができた。

これは簡単なプロセスで、Heroku のリモートにコードをプッシュするたびに、
新しいビルドが開始される。Heroku が Docker のビルドとデプロイを行う。

あまり詳しい説明はしないが、すでに Heroku のアカウントを作成し、
CLI ツールをインストールしたと仮定する。
Scoop でアプリを管理している場合は次のコマンドで CLI をインストールできる。

``` console
scoop instal heroku-cli
```

ログインしていることを確認しておく。

``` console
heroku login
```

プロジェクトのルートに、heroku.yml というファイルを追加する。
これは、Heroku にアプリケーションのデプロイ方法を伝えるもの。

## Git

まだ作成していない場合は、プロジェクトのルートに git リポジトリを作成する。
git の混乱を避けるため、client/.git ディレクトリが削除されていることを確認しておく。

GitHub には事前にリモートリポジトリを作成しておく。

``` console
git init
git add .
git commit -m 'First commit'
git branch -M main
git remote add origin ＜リモートリポジトリの URL＞
git push -u origin main
```

これらのコマンドを実行すると、私たちが行ったすべての作業を含む
単一のコミットを持つ初期リポジトリが作成される。

それでは、新しい Heroku アプリケーションを作ってみる :)

``` console 
heroku create
Creating app... done, ⬢ blooming-hamlet-53782
https://blooming-hamlet-53782.herokuapp.com/ | https://git.heroku.com/blooming-hamlet-53782.git
```

まず、新しいアプリケーションを作成した。
提案された URL と git リモートが分かる (cli ツールが .git/config に Heroku リモートを
追加した)。

``` console
heroku stack:set container
Setting stack to container... done
```

次に、このスタックにコンテナをデプロイするつもりであることを Heroku に伝える必要がある。
これが完了したら、デプロイを開始する。

``` console
git add 
git commit -m 'Initial commit'
git push heroku main

# プロダクション URLなどを取得する必要がある場合は
heroku apps:info
=== blooming-hamlet-53782
Auto Cert Mgmt: false
Dynos:          web: 1
Git URL:        https://git.heroku.com/blooming-hamlet-53782.git
Owner:          ＜ユーザアカウント＞
Region:         us
Repo Size:      0 B
Slug Size:      0 B
Stack:          container
Web URL:        https://blooming-hamlet-53782.herokuapp.com/
```

ここで PaaS の魔法が起こる。
HTML などのちょっとしたコードを変更して、それを heroku リモートにプッシュすると、
heroku はそのコードを格納して、新しい不変的なコンテナを作成してデプロイしてくれる。

> 小さな git コミットをネットワーク（電車の中でのモバイル接続など）に
> プッシュすると、Heroku がビルドしてデプロイしてくれるというのは、
> とてもエキサイティングに感じる

## まとめ

ローカルでの作業を容易にし、自由に変更を本番環境に反映させることができる
（そして、プラットフォームがコンピュートのプロビジョニングとデプロイを行う）
というのは、最初のスタートとしては素晴らしいことだと思う。

しかし、ただの API とクライアントでは不十分である。
 [パート２](./README.PART.02.md) では、Heroku Postgres アドオンのプロビジョニングを見て、
ローカルでの開発をスクラッチにして、Heroku のリリース段階の
デプロイメントプロセスを使って、
リリース時にデータベースをプッシュしてマイグレーションできるようにする。