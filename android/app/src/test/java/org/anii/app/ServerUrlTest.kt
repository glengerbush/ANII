package org.anii.app
import org.junit.Assert.*
import org.junit.Test
class ServerUrlTest {
    @Test fun acceptsLocalHttpsAndBasePaths() {
        assertEquals("http://192.168.1.2:3000", normalizeServerUrl(" http://192.168.1.2:3000/ "))
        assertEquals("https://example.com/anii", normalizeServerUrl("https://example.com/anii/"))
        assertEquals("http://[::1]:3000", normalizeServerUrl("http://[::1]:3000"))
    }
    @Test fun rejectsCredentialsQueriesAndNonServers() {
        listOf("", "example.com", "file:///tmp/a", "javascript:alert(1)", "https://a:b@example.com", "https://example.com?q=a", "https://example.com/#a", "https://example.com:99999", "https://example.com/a/../b").forEach { input ->
            assertThrows(IllegalArgumentException::class.java) { normalizeServerUrl(input) }
        }
    }
}
