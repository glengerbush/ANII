package org.anii.app

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Run against the disposable server at 10.0.2.2:5197; never a production server. */
class ConnectionFlowTest {
    @get:Rule val ui = createEmptyComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun waitFor(text: String) = ui.waitUntil(20_000) { ui.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty() }
    private fun screenshot(name: String) {
        ui.waitForIdle()
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        Thread.sleep(500) // Allow the emulator compositor to present the verified Compose frame.
        val bitmap = InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val directory = java.io.File(InstrumentationRegistry.getArguments().getString("additionalTestOutputDir") ?: context.filesDir.path)
        directory.mkdirs()
        java.io.File(directory, "review-$name.png").outputStream().use { bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
    @Test fun connectsPersistsAcrossRecreationCreatesTasksAndKeepsUrlAfterFailedEdit() {
        val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
        ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use { activity ->
            ui.onNodeWithText("Welcome to ANII").assertIsDisplayed()
            screenshot("welcome")
            ui.onNodeWithText("Server URL").performTextInput("http://10.0.2.2:5197")
            ui.onNodeWithText("Connect", useUnmergedTree = true).performClick()
            waitFor("Planning as")
            assertEquals("http://10.0.2.2:5197", prefs.getString("server", null))
            activity.recreate()
            waitFor("Planning as")
            ui.onNodeWithText("Welcome to ANII").assertDoesNotExist()
            ui.onNodeWithContentDescription("New task").performClick()
            val task = "Android smoke ${System.currentTimeMillis()}"
            ui.onNodeWithText("Title").performTextInput(task)
            ui.onNodeWithText("Save", useUnmergedTree = true).performClick()
            waitFor(task)
            screenshot("now")
            ui.onNodeWithText("Projects", useUnmergedTree = true).performClick()
            ui.waitUntil(15_000) { ui.onAllNodesWithContentDescription("New project").fetchSemanticsNodes().isNotEmpty() }
            ui.onNodeWithContentDescription("New project").performClick()
            val project = "Android project ${System.currentTimeMillis()}"
            ui.onNodeWithText("Title").performTextInput(project)
            ui.onNodeWithText("Save", useUnmergedTree = true).performClick()
            waitFor(project)
            ui.onNodeWithText(project).performClick()
            waitFor("Mark complete")
            screenshot("project")
            ui.onNodeWithText("Mark complete").performClick()
            waitFor("Reopen project")
            ui.onNodeWithText("Reopen project").performClick()
            waitFor("Mark complete")
            ui.onNodeWithContentDescription("Back").performClick()
            waitFor(project)
            ui.onNodeWithText("Calendar", useUnmergedTree = true).performClick()
            ui.waitUntil(15_000) { ui.onAllNodesWithContentDescription("Schedule task").fetchSemanticsNodes().isNotEmpty() }
            screenshot("calendar")
            ui.onNodeWithContentDescription("Schedule task").performClick()
            ui.onNodeWithText("Search tasks").performTextInput(task)
            waitFor(task)
            ui.onNode(hasText(task) and hasAnyAncestor(hasTestTag("schedule-results"))).performClick()
            ui.waitUntil(15_000) { ui.onAllNodesWithText("Search tasks").fetchSemanticsNodes().isEmpty() }
            ui.onNodeWithText("Now", useUnmergedTree = true).performClick()
            waitFor(task)
            ui.onNodeWithContentDescription("Complete $task").performClick()
            waitFor("Show completed")
            ui.onNodeWithText("Completed", useUnmergedTree = true).performClick()
            waitFor(task)
            ui.onNodeWithContentDescription("Settings").performClick()
            waitFor("Edit server URL")
            screenshot("settings")
            ui.onNodeWithText("Edit server URL").performClick()
            ui.onNodeWithText("Server URL").performTextReplacement("http://127.0.0.1:1")
            ui.onNodeWithText("Save server").performClick()
            waitFor("Failed to connect")
            assertEquals("http://10.0.2.2:5197", prefs.getString("server", null))
            ui.onNodeWithText("Cancel").performClick()
        }
        ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use {
            waitFor("Planning as")
            ui.onNodeWithText("Welcome to ANII").assertDoesNotExist()
        }
    }
}
