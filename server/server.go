/*
 * SPDX-FileCopyrightText: © 2017-2026 Istari Digital, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

package server

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

const (
	defaultPort = 8000
	defaultAddr = ""

	indexPath = "index.html"
)

var (
	port       int
	addr       string
	version    string
	commitINFO string
	commitID   string

	tlsCrt string
	tlsKey string

	listenAddr string

	urlPrefix     string
	queriesDBPath string
)

// Run starts the server.
func Run() {
	parseFlags()

	if err := InitDB(queriesDBPath); err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer CloseDB()

	indexContent := prepareIndexContent()

	mux := newServeMux(indexContent, urlPrefix)

	addrStr := fmt.Sprintf("%s:%d", listenAddr, port)
	if urlPrefix != "" {
		log.Printf("Serving under URL prefix %s/", urlPrefix)
	}
	log.Printf("Listening on %s...", addrStr)

	switch {
	case tlsCrt != "":
		log.Fatalln(http.ListenAndServeTLS(addrStr, tlsCrt, tlsKey, mux))
	default:
		log.Fatalln(http.ListenAndServe(addrStr, mux))
	}
}

// newServeMux builds the HTTP routing for the Ratel server. With an empty
// prefix all content is served from the root, preserving historic behavior.
// With a prefix (e.g. "/ratel") all content is served under that prefix, the
// bare prefix redirects to "<prefix>/", and any other path returns 404 with a
// hint pointing at the prefix. Saved-queries API routes are always at root.
func newServeMux(indexContent *content, prefix string) *http.ServeMux {
	mux := http.NewServeMux()
	mainHandler := makeMainHandler(indexContent)

	// Saved-queries API routes are always at root regardless of prefix.
	mux.HandleFunc("/api/saved-queries/", handleSavedQueryByID)
	mux.HandleFunc("/api/saved-queries", handleSavedQueries)

	if prefix == "" {
		mux.Handle("/", mainHandler)
		return mux
	}

	mux.Handle(prefix+"/", http.StripPrefix(prefix, mainHandler))
	mux.Handle(prefix, http.RedirectHandler(prefix+"/", http.StatusMovedPermanently))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, fmt.Sprintf("Not found. Ratel is served under %s/", prefix),
			http.StatusNotFound)
	})
	return mux
}

func parseFlags() {
	portPtr := flag.Int("port", defaultPort, "Port on which the ratel server will run.")
	addrPtr := flag.String("addr", defaultAddr, "Address of the Dgraph server.")
	versionFlagPtr := flag.Bool("version", false, "Prints the version of ratel.")
	tlsCrtPtr := flag.String("tls_crt", "", "TLS cert for serving HTTPS requests.")
	tlsKeyPtr := flag.String("tls_key", "", "TLS key for serving HTTPS requests.")
	listenAddrPtr := flag.String("listen-addr", defaultAddr, "Address Ratel server should listen on.")
	urlPrefixPtr := flag.String("url-prefix", "",
		"URL path prefix under which Ratel is served, e.g. \"/ratel\" "+
			"(falls back to the RATEL_URL_PREFIX environment variable).")
	queriesDBPtr := flag.String("queries-db", "",
		"Path to SQLite database file for saved queries. Can also be set via RATEL_QUERIES_DB env var.")

	flag.Parse()

	if *versionFlagPtr {
		fmt.Printf("Ratel Version: %s\n", version)
		fmt.Printf("Commit ID: %s\n", commitID)
		fmt.Printf("Commit Info: %s\n", commitINFO)
		os.Exit(0)
	}

	var err error
	addr, err = validateAddr(*addrPtr)
	if err != nil && err != errAddrNil {
		fmt.Printf("Error parsing Dgraph server address: %s\n", err.Error())
		os.Exit(1)
	}

	port = *portPtr

	tlsCrt = *tlsCrtPtr
	tlsKey = *tlsKeyPtr

	listenAddr = *listenAddrPtr

	prefix := *urlPrefixPtr
	if prefix == "" {
		prefix = os.Getenv("RATEL_URL_PREFIX")
	}
	urlPrefix = normalizeURLPrefix(prefix)

	// Handle queries DB path (flag takes precedence over env var, then a
	// persistent per-user default).
	queriesDBPath = *queriesDBPtr
	if queriesDBPath == "" {
		queriesDBPath = os.Getenv("RATEL_QUERIES_DB")
	}
	if queriesDBPath == "" {
		queriesDBPath = defaultQueriesDBPath()
	}
}

// normalizeURLPrefix ensures a prefix has a leading slash and no trailing
// slash. Empty input and "/" normalize to "" (no prefix).
func normalizeURLPrefix(prefix string) string {
	prefix = strings.TrimSpace(prefix)
	prefix = strings.TrimRight(prefix, "/")
	if prefix == "" {
		return ""
	}
	if !strings.HasPrefix(prefix, "/") {
		prefix = "/" + prefix
	}
	return prefix
}

// defaultQueriesDBPath returns a persistent location for the saved-queries
// database, creating the parent directory if needed. It falls back to the temp
// dir only if the user config dir is unavailable.
func defaultQueriesDBPath() string {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return filepath.Join(os.TempDir(), "ratel_queries.db")
	}
	dir := filepath.Join(configDir, "ratel")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return filepath.Join(os.TempDir(), "ratel_queries.db")
	}
	return filepath.Join(dir, "queries.db")
}

func prepareIndexContent() *content {
	bs, err := Asset(indexPath)
	if err != nil {
		panic(fmt.Sprintf("Error retrieving \"%s\" asset", indexPath))
	}

	info, err := AssetInfo(indexPath)
	if err != nil {
		panic(fmt.Sprintf("Error retrieving \"%s\" asset info", indexPath))
	}

	tmpl, err := template.New(indexPath).Parse(string(bs))
	if err != nil {
		panic(fmt.Sprintf("Error parsing \"%s\" contents", indexPath))
	}

	data := struct {
		Addr string
	}{
		Addr: addr,
	}

	buf := bytes.NewBuffer([]byte{})
	err = tmpl.Execute(buf, data)
	if err != nil {
		log.Fatalln(err)
		panic(fmt.Sprintf("Error executing \"%s\" template", indexPath))
	}

	return &content{
		name:    info.Name(),
		modTime: info.ModTime(),
		bs:      rewriteURLPrefix(buf.Bytes(), urlPrefix),
	}
}

// hrefSrcRe matches root-relative URLs in href/src attributes, e.g.
// href="/favicon.ico" or src="/static/js/main.js". It deliberately does not
// match protocol-relative URLs such as href="//cdn.example.com/x.js".
var hrefSrcRe = regexp.MustCompile(`\b(href|src)="(/(?:[^/"][^"]*)?)"`)

// rewriteURLPrefix rewrites root-relative asset URLs in the index.html
// payload so they resolve when Ratel is served under a URL prefix.
func rewriteURLPrefix(bs []byte, prefix string) []byte {
	if prefix == "" {
		return bs
	}

	out := hrefSrcRe.ReplaceAllFunc(bs, func(m []byte) []byte {
		sub := hrefSrcRe.FindSubmatch(m)
		return []byte(string(sub[1]) + `="` + prefix + string(sub[2]) + `"`)
	})

	// index.html injects the fallback loader script via an absolute path in
	// inline JavaScript: injectJs('/loader.js').
	out = bytes.ReplaceAll(out, []byte(`'/loader.js'`),
		[]byte(`'`+prefix+`/loader.js'`))

	return out
}

func makeMainHandler(indexContent *content) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")

		if path == "" || path == indexPath {
			indexContent.serve(w, r)
			return
		}

		bs, err := Asset(path)
		if err != nil {
			http.Error(w, "Asset not found for path "+path, http.StatusNotFound)
			return
		}

		info, err := AssetInfo(path)
		if err != nil {
			http.Error(w, "AssetInfo not found for path"+path, http.StatusNotFound)
			return
		}

		http.ServeContent(w, r, info.Name(), info.ModTime(), newBuffer(bs))
	}
}

// maxQueryBodyBytes caps request bodies so a runaway payload can't be buffered
// wholesale before validation.
const maxQueryBodyBytes = 1 << 20 // 1 MiB

// writeJSONError writes a JSON {"error": msg} body with the given status code.
func writeJSONError(w http.ResponseWriter, code int, msg string) {
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// decodeQueryInput reads and validates a SavedQueryInput from the request body,
// writing the appropriate error response and returning false on failure.
func decodeQueryInput(w http.ResponseWriter, r *http.Request) (SavedQueryInput, bool) {
	var input SavedQueryInput
	r.Body = http.MaxBytesReader(w, r.Body, maxQueryBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid JSON")
		return input, false
	}
	if input.Name == "" || input.Query == "" {
		writeJSONError(w, http.StatusBadRequest, "Name and query are required")
		return input, false
	}
	return input, true
}

// requireQuery confirms a query exists, writing a 500 on lookup failure or a 404
// if missing, and returning false in either case.
func requireQuery(w http.ResponseWriter, id int64) bool {
	existing, err := GetQueryByID(id)
	if err != nil {
		log.Printf("Error fetching query: %v", err)
		writeJSONError(w, http.StatusInternalServerError, "Failed to fetch query")
		return false
	}
	if existing == nil {
		writeJSONError(w, http.StatusNotFound, "Query not found")
		return false
	}
	return true
}

// handleSavedQueries handles GET (list all) and POST (create) requests
func handleSavedQueries(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		queries, err := GetAllQueries()
		if err != nil {
			log.Printf("Error fetching queries: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Failed to fetch queries")
			return
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"enabled": true,
			"queries": queries,
		})

	case http.MethodPost:
		input, ok := decodeQueryInput(w, r)
		if !ok {
			return
		}

		query, err := CreateQuery(input)
		if err != nil {
			log.Printf("Error creating query: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Failed to create query")
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(query)

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}

// handleSavedQueryByID handles PUT (update) and DELETE requests for a specific query
func handleSavedQueryByID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Extract ID from URL path: /api/saved-queries/{id}
	path := strings.TrimPrefix(r.URL.Path, "/api/saved-queries/")
	id, err := strconv.ParseInt(path, 10, 64)
	if err != nil {
		writeJSONError(w, http.StatusBadRequest, "Invalid query ID")
		return
	}

	switch r.Method {
	case http.MethodPut:
		input, ok := decodeQueryInput(w, r)
		if !ok {
			return
		}
		if !requireQuery(w, id) {
			return
		}

		query, err := UpdateQuery(id, input)
		if err != nil {
			log.Printf("Error updating query: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Failed to update query")
			return
		}

		json.NewEncoder(w).Encode(query)

	case http.MethodDelete:
		if !requireQuery(w, id) {
			return
		}

		if err := DeleteQuery(id); err != nil {
			log.Printf("Error deleting query: %v", err)
			writeJSONError(w, http.StatusInternalServerError, "Failed to delete query")
			return
		}

		w.WriteHeader(http.StatusNoContent)

	default:
		writeJSONError(w, http.StatusMethodNotAllowed, "Method not allowed")
	}
}
