package org.anii.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TaskDecodingTest {
    @Test fun taskDecodingPreservesEveryoneNoOneAndOptionalFields() {
        val raw = JSONObject("""{"id":7,"title":"Paint","state":"open","start_date":null,"assignee_id":null,"creator_id":null,"remaining_effort_minutes":null,"project_ids":[],"blocked":0}""")
        val unassigned = Task(raw)
        assertEquals(Assignment.NoOne, unassigned.assignment)
        assertNull(unassigned.schedule)
        assertNull(unassigned.creatorId)
        assertEquals("", unassigned.effortHours)
        raw.put("start_date", "2026-11-23")
        assertEquals(Assignment.Everyone, Task(raw).assignment)
        raw.put("assignee_id", 3).put("remaining_effort_minutes", 75).put("creator_id", 2).put("queued", true).put("blocked", 1)
        val assigned = Task(raw)
        assertEquals(Assignment.Person(3), assigned.assignment)
        assertEquals("2026-11-23", assigned.startDate)
        assertEquals("1.25", assigned.effortHours)
        assertEquals(2, assigned.creatorId)
        assertTrue(assigned.queued)
        assertTrue(assigned.blocked)
    }
}
