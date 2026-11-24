package org.anii.app

import org.junit.Assert.*
import org.junit.Test

class TasksTest {
    private fun request(change: TaskChange): TaskRequest {
        var sent: TaskRequest? = null
        var completed = false
        change.send(TaskTransport { value, done -> sent = value; done() }) { completed = true }
        assertTrue(completed)
        return requireNotNull(sent)
    }
    @Test fun assignmentsDistinguishNoOneEveryoneAndAProfile() {
        val none = request(TaskChange.assign(7, Assignment.NoOne))
        assertEquals("none", none.fields["assigneeId"])
        assertFalse(none.fields.containsKey("startDate"))
        assertEquals("schedule", none.action)
        assertEquals("backlog", none.view)
        assertEquals("everyone", request(TaskChange.assign(7, Assignment.Everyone)).fields["assigneeId"])
        val dated = request(TaskChange.assign(7, Assignment.Person(3), "2026-11-23"))
        assertEquals(mapOf("taskId" to "7", "assigneeId" to "3", "startDate" to "2026-11-23"), dated.fields)
        assertEquals(Assignment.Person(3), Assignment.fromChoice(Assignment.Person(3).choice))
        assertEquals("No one", Assignment.NoOne.label(emptyList()))
        assertEquals("Pat", Assignment.Person(3).label(listOf(PersonName(3, "Pat"))))
    }
    @Test fun queueAndCompletionUseSharedTaskActionsFromAnyScreen() {
        assertEquals(mapOf("taskId" to "4", "planned" to "false"), request(TaskChange.queue(4, false)).fields)
        val complete = request(TaskChange.complete(4, true))
        assertEquals("backlog", complete.view)
        assertEquals(mapOf("id" to "4", "state" to "completed"), complete.fields)
        assertEquals("open", request(TaskChange.complete(4, false)).fields["state"])
        assertEquals("unschedule", request(TaskChange.unschedule(4)).action)
    }
    @Test fun orderingUsesPositionsForNowAndVisibleAnchorsForBacklogAndProjects() {
        val a = Task(1, "A", queued = true, section = "focus")
        val b = Task(2, "B", queued = true, section = "also")
        val c = Task(3, "C", queued = true, section = "also")
        val hidden = Task(4, "Not queued")
        val visible = listOf(a, b, c, hidden)
        val now = request(requireNotNull(TaskChange.move(b, visible, TaskLocation.Now, 1)))
        assertEquals("now", now.view)
        assertEquals(mapOf("id" to "2", "section" to "also", "position" to "1"), now.fields)
        assertNull(TaskChange.move(c, visible, TaskLocation.Now, 1))
        val backlog = request(requireNotNull(TaskChange.move(c, visible, TaskLocation.Backlog, -1)))
        assertEquals(mapOf("taskId" to "3", "anchorId" to "2", "edge" to "before", "group" to "queued"), backlog.fields)
        assertNull(TaskChange.move(c, visible, TaskLocation.Backlog, 1))
        val project = request(requireNotNull(TaskChange.move(c, visible, TaskLocation.Project(8), 1)))
        assertEquals("project", project.view)
        assertEquals("id=8", project.query)
        assertEquals(mapOf("taskId" to "3", "anchorId" to "4", "edge" to "after"), project.fields)
    }
    @Test fun creationAndEditingPreserveTheirDestinationAndUnits() {
        assertEquals("quickAdd", request(TaskChange.create("Now", TaskLocation.Now)).action)
        assertEquals("backlog", request(TaskChange.create("Later", TaskLocation.Backlog)).view)
        val project = request(TaskChange.create("Project work", TaskLocation.Project(9)))
        assertEquals("id=9", project.query)
        assertEquals("project", project.view)
        val edit = request(TaskChange.edit(8, TaskEdit("Title", "Notes", "30m", "", "1.25", "")))
        assertEquals("1.25", edit.fields["remainingHours"])
        assertEquals("0", edit.fields["leadTimeDays"])
        assertEquals("Notes", edit.fields["details"])
        assertEquals("1.25", Task(1, "Effort", effortMinutes = 75).effortHours)
    }
    @Test fun failedTransportDoesNotAcknowledgeChanges() {
        var acknowledged = false
        try {
            TaskChange.delete(2).send(TaskTransport { _, _ -> throw IllegalStateException("offline") }) { acknowledged = true }
            fail("Expected transport failure")
        } catch (_: IllegalStateException) { assertFalse(acknowledged) }
    }
}
