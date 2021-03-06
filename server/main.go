package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
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

		message := ""
		if lastDate.Valid {
			message = fmt.Sprintf("%v経過", time.Now().Sub(lastDate.Time).String())
			message = strings.Replace(message, "h", "時間", -1)
			message = strings.Replace(message, "m", "分", -1)
			message = strings.Replace(message, "s", "秒", -1)
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
