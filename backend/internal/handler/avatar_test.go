//go:build integration

package handler_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/DowLucas/strong-notes-backend/internal/server"
	"github.com/DowLucas/strong-notes-backend/testutil"
)

// avatarEnv wires up a router with real MinIO storage and a single user.
type avatarEnv struct {
	env   *testutil.Env
	alice testUserEnv
}

type testUserEnv struct {
	ID    string
	Email string
	Token string
}

func setupAvatarEnv(t *testing.T) avatarEnv {
	t.Helper()
	env := testutil.NewEnv(t)
	store := testutil.SharedStorage(t)
	env.Router = server.New(env.Config, env.Pool, env.Queries, env.JWT, store, nil)

	a := testutil.CreateUser(t, env.Pool, uniqueEmail(t, "alice"), "Alice")

	return avatarEnv{
		env:   env,
		alice: testUserEnv{ID: a.ID, Email: a.Email, Token: env.MintToken(t, a.ID, a.Email)},
	}
}

func makeJPEGBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}))
	return buf.Bytes()
}

func makePNGBytes(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{200, 100, 50, 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func uploadAvatarBody(data []byte, mime string) string {
	return fmt.Sprintf(`{"image_base64": %q, "mime_type": %q}`,
		base64.StdEncoding.EncodeToString(data), mime)
}

func uploadAvatar(t *testing.T, env *testutil.Env, token string, data []byte, mime string) *http.Response {
	t.Helper()
	req := env.AuthRequest(t, http.MethodPost, "/api/me/avatar", uploadAvatarBody(data, mime), token)
	rr := env.Do(t, req)
	return rr.Result()
}

func TestAvatar_Upload_Success(t *testing.T) {
	e := setupAvatarEnv(t)
	resp := uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 600, 600), "image/jpeg")
	assert.Equal(t, http.StatusOK, resp.StatusCode)

	user, err := e.env.Queries.GetUserByID(context.Background(), e.alice.ID)
	require.NoError(t, err)
	assert.NotNil(t, user.AvatarObjectKey)
	assert.True(t, user.AvatarUpdatedAt.Valid)
}

func TestAvatar_Upload_SizeLimit(t *testing.T) {
	e := setupAvatarEnv(t)
	// 6 MB of random-ish JPEG bytes — exceed the cap.
	big := bytes.Repeat([]byte{0xFF, 0xD8, 0xFF, 0xE0}, 6*1024*1024/4+10)
	resp := uploadAvatar(t, e.env, e.alice.Token, big, "image/jpeg")
	// MaxBytesReader may surface as 400 (invalid JSON because the body is
	// truncated) or 413 (when the inflated base64 is over the JSON cap).
	assert.Contains(t, []int{http.StatusRequestEntityTooLarge, http.StatusBadRequest}, resp.StatusCode)
}

func TestAvatar_Upload_RejectsUnsupportedMime(t *testing.T) {
	e := setupAvatarEnv(t)
	resp := uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 64, 64), "image/gif")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestAvatar_Upload_RejectsMimeMismatch(t *testing.T) {
	e := setupAvatarEnv(t)
	// JPEG bytes but claim PNG.
	resp := uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 64, 64), "image/png")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

// Feeds the handler a tiny PNG that declares a 60000x60000 image in its IHDR.
// A real Go image.Decode would allocate ~14 GB for the pixel buffer and OOM
// the server. The handler must call image.DecodeConfig first and reject when
// width*height exceeds the maxAvatarPixels budget BEFORE image.Decode runs.
func TestAvatar_Upload_RejectsDecompressionBomb(t *testing.T) {
	e := setupAvatarEnv(t)
	bomb := makeBombPNG(60000, 60000)
	resp := uploadAvatar(t, e.env, e.alice.Token, bomb, "image/png")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode,
		"giant-dimension PNG must be rejected before image.Decode allocates the pixel buffer")
}

// makeBombPNG returns a syntactically valid PNG header (signature + IHDR +
// IEND) that declares the given dimensions. image.DecodeConfig needs only the
// IHDR and returns the declared width/height — exactly the bomb scenario.
func makeBombPNG(width, height uint32) []byte {
	put32 := func(b []byte, v uint32) {
		b[0] = byte(v >> 24)
		b[1] = byte(v >> 16)
		b[2] = byte(v >> 8)
		b[3] = byte(v)
	}
	out := []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}
	ihdr := make([]byte, 4+4+13+4)
	put32(ihdr[0:4], 13)
	copy(ihdr[4:8], []byte("IHDR"))
	put32(ihdr[8:12], width)
	put32(ihdr[12:16], height)
	ihdr[16] = 8 // bit depth
	ihdr[17] = 2 // color type (RGB)
	ihdr[18] = 0 // compression
	ihdr[19] = 0 // filter
	ihdr[20] = 0 // interlace
	ihdr[21], ihdr[22], ihdr[23], ihdr[24] = pngCRC(ihdr[4:21])
	out = append(out, ihdr...)
	iend := []byte{0, 0, 0, 0, 'I', 'E', 'N', 'D', 0xAE, 0x42, 0x60, 0x82}
	out = append(out, iend...)
	return out
}

func pngCRC(b []byte) (byte, byte, byte, byte) {
	// IEEE 802.3 CRC32, polynomial 0xEDB88320.
	crc := uint32(0xFFFFFFFF)
	for _, x := range b {
		crc ^= uint32(x)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = (crc >> 1) ^ 0xEDB88320
			} else {
				crc >>= 1
			}
		}
	}
	crc ^= 0xFFFFFFFF
	return byte(crc >> 24), byte(crc >> 16), byte(crc >> 8), byte(crc)
}

func TestAvatar_Upload_RejectsCorruptImage(t *testing.T) {
	e := setupAvatarEnv(t)
	// JPEG SOI marker so the content sniff says "image/jpeg" — but the rest is
	// garbage so image.Decode rejects it. This is the polyglot defense path.
	corrupt := append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte("not an image"), 50)...)
	resp := uploadAvatar(t, e.env, e.alice.Token, corrupt, "image/jpeg")
	assert.Equal(t, http.StatusBadRequest, resp.StatusCode)
}

func TestAvatar_Upload_StripsExif(t *testing.T) {
	e := setupAvatarEnv(t)

	jpegSrc := makeJPEGBytes(t, 600, 400)
	exifSeg := []byte{0xFF, 0xE1, 0x00, 0x10, 'E', 'x', 'i', 'f', 0x00, 0x00, 'M', 'M', 0x00, 0x2A, 0, 0, 0, 8}
	withExif := append([]byte{}, jpegSrc[:2]...)
	withExif = append(withExif, exifSeg...)
	withExif = append(withExif, jpegSrc[2:]...)
	require.True(t, bytes.Contains(withExif, []byte{0xFF, 0xE1}))
	require.True(t, bytes.Contains(withExif, []byte("Exif\x00\x00")))

	resp := uploadAvatar(t, e.env, e.alice.Token, withExif, "image/jpeg")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	getReq := e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token)
	rr := e.env.Do(t, getReq)
	require.Equal(t, http.StatusOK, rr.Code)
	body := rr.Body.Bytes()
	assert.False(t, bytes.Contains(body, []byte("Exif\x00\x00")), "EXIF marker leaked into stored avatar")

	img, _, err := image.Decode(bytes.NewReader(body))
	require.NoError(t, err)
	b := img.Bounds()
	assert.LessOrEqual(t, b.Dx(), 512)
	assert.LessOrEqual(t, b.Dy(), 512)
}

func TestAvatar_Upload_NormalizesDimensions(t *testing.T) {
	e := setupAvatarEnv(t)
	resp := uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 2000, 1000), "image/jpeg")
	require.Equal(t, http.StatusOK, resp.StatusCode)

	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	require.Equal(t, http.StatusOK, rr.Code)
	img, _, err := image.Decode(rr.Body)
	require.NoError(t, err)
	b := img.Bounds()
	assert.Equal(t, 512, b.Dx())
	assert.Equal(t, 512, b.Dy())
}

func TestAvatar_Get_Self_OK(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)

	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	assert.Equal(t, http.StatusOK, rr.Code)
}

// This single-account scaffold only serves the caller's own avatar; another
// user's id must 404 (not leak existence).
func TestAvatar_Get_OtherUser_404(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)

	other := testutil.CreateUser(t, e.env.Pool, uniqueEmail(t, "other"), "Other")
	otherToken := e.env.MintToken(t, other.ID, other.Email)
	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", otherToken))
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestAvatar_Get_NonexistentUser_404(t *testing.T) {
	e := setupAvatarEnv(t)
	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/01H000000000000000000000XX/avatar", "", e.alice.Token))
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestAvatar_Get_UserExistsNoUpload_404(t *testing.T) {
	e := setupAvatarEnv(t)
	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestAvatar_Delete_RemovesObjectAndRow(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)

	user, err := e.env.Queries.GetUserByID(context.Background(), e.alice.ID)
	require.NoError(t, err)
	require.NotNil(t, user.AvatarObjectKey)
	oldKey := *user.AvatarObjectKey
	require.NotEmpty(t, oldKey)

	delResp := e.env.Do(t, e.env.AuthRequest(t, http.MethodDelete, "/api/me/avatar", "", e.alice.Token))
	require.Equal(t, http.StatusNoContent, delResp.Code)

	user, err = e.env.Queries.GetUserByID(context.Background(), e.alice.ID)
	require.NoError(t, err)
	assert.Nil(t, user.AvatarObjectKey)

	store := testutil.SharedStorage(t)
	_, err = store.Open(context.Background(), oldKey)
	assert.Error(t, err, "stored object should be gone")
}

func TestAvatar_Delete_IdempotentWhenAbsent(t *testing.T) {
	e := setupAvatarEnv(t)
	resp := e.env.Do(t, e.env.AuthRequest(t, http.MethodDelete, "/api/me/avatar", "", e.alice.Token))
	assert.Equal(t, http.StatusNoContent, resp.Code)
}

func TestAvatar_Upload_DeletesPreviousObject(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)
	first, err := e.env.Queries.GetUserByID(context.Background(), e.alice.ID)
	require.NoError(t, err)
	require.NotNil(t, first.AvatarObjectKey)
	firstKey := *first.AvatarObjectKey

	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makePNGBytes(t, 300, 300), "image/png").StatusCode)
	second, err := e.env.Queries.GetUserByID(context.Background(), e.alice.ID)
	require.NoError(t, err)
	require.NotNil(t, second.AvatarObjectKey)
	assert.NotEqual(t, firstKey, *second.AvatarObjectKey)

	store := testutil.SharedStorage(t)
	_, err = store.Open(context.Background(), firstKey)
	assert.Error(t, err, "old object should have been deleted")
}

func TestAvatar_Get_RequiresAuth(t *testing.T) {
	e := setupAvatarEnv(t)
	req, err := http.NewRequest(http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", nil)
	require.NoError(t, err)
	rr := e.env.Do(t, req)
	assert.Equal(t, http.StatusUnauthorized, rr.Code)
}

func TestAvatar_Get_ETag_304(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)

	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	require.Equal(t, http.StatusOK, rr.Code)
	etag := rr.Header().Get("ETag")
	require.NotEmpty(t, etag)
	_, _ = io.Copy(io.Discard, rr.Body)

	req := e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token)
	req.Header.Set("If-None-Match", etag)
	rr2 := e.env.Do(t, req)
	assert.Equal(t, http.StatusNotModified, rr2.Code)
}

func TestAvatar_Get_ETag_DeterministicForSameKey(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 200, 200), "image/jpeg").StatusCode)

	rr1 := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	require.Equal(t, http.StatusOK, rr1.Code)
	etag1 := rr1.Header().Get("ETag")
	require.NotEmpty(t, etag1)

	// Bump avatar_updated_at directly — etag must NOT change since the
	// (userID, objectKey) is the same.
	_, err := e.env.Pool.Exec(context.Background(),
		"UPDATE users SET avatar_updated_at = now() + interval '1 hour' WHERE id = $1",
		e.alice.ID)
	require.NoError(t, err)

	rr2 := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/users/"+e.alice.ID+"/avatar", "", e.alice.Token))
	require.Equal(t, http.StatusOK, rr2.Code)
	etag2 := rr2.Header().Get("ETag")
	assert.Equal(t, etag1, etag2, "ETag must be content-derived (userID|objectKey), not timestamp-derived")
}

// Verify /api/me exposes the avatar fields after upload.
func TestAvatar_MeResponse_IncludesAvatarObjectURL(t *testing.T) {
	e := setupAvatarEnv(t)
	require.Equal(t, http.StatusOK,
		uploadAvatar(t, e.env, e.alice.Token, makeJPEGBytes(t, 100, 100), "image/jpeg").StatusCode)

	rr := e.env.Do(t, e.env.AuthRequest(t, http.MethodGet, "/api/me", "", e.alice.Token))
	require.Equal(t, http.StatusOK, rr.Code)
	var body map[string]any
	require.NoError(t, json.NewDecoder(rr.Body).Decode(&body))
	assert.Equal(t, "/api/users/"+e.alice.ID+"/avatar", body["avatar_object_url"])
	assert.NotEmpty(t, body["avatar_updated_at"])
}
