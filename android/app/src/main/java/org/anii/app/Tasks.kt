package org.anii.app

import org.json.JSONObject

/** Choice keys are UI persistence details; wire sentinels stay inside this module. */
sealed class Assignment(val choice: Int) {
    data object NoOne : Assignment(0)
    data object Everyone : Assignment(-1)
    data class Person(val id: Int) : Assignment(id) { init { require(id > 0) } }
    fun label(people: List<PersonName>): String = when (this) {
        NoOne -> "No one"
        Everyone -> "Everyone"
        is Person -> people.find { it.id == id }?.name ?: "Unknown user"
    }
    companion object {
        fun fromChoice(choice: Int): Assignment = when (choice) { 0 -> NoOne; -1 -> Everyone; else -> Person(choice) }
        fun choices(people: List<PersonName>): List<Pair<Int, String>> =
            listOf(NoOne.choice to "No one") + people.map { it.id to it.name } + (Everyone.choice to "Everyone")
    }
}
data class PersonName(val id: Int, val name: String)
data class Schedule(val startDate: String, val assignment: Assignment)
data class Task(
    val id: Int, val title: String, val completed: Boolean = false, val queued: Boolean = false,
    val section: String = "", val projects: Set<Int> = emptySet(), val details: String = "",
    val duration: String = "", val dueDate: String = "", val effortMinutes: Int? = null,
    val leadTimeDays: Int = 0, val schedule: Schedule? = null, val assigneeName: String = "",
    val creatorId: Int? = null, val blocked: Boolean = false
) {
    constructor(raw: JSONObject) : this(
        id = raw.getInt("id"), title = raw.text("title"), completed = raw.text("state") == "completed",
        queued = raw.optBoolean("queued"), section = raw.text("section"), projects = raw.ids("project_ids"),
        details = raw.text("details"), duration = raw.text("duration_bucket"), dueDate = raw.text("due_at"),
        effortMinutes = if (raw.isNull("remaining_effort_minutes")) null else raw.getInt("remaining_effort_minutes"),
        leadTimeDays = raw.optInt("lead_time_days"), schedule = raw.text("start_date").takeIf { it.isNotBlank() }?.let {
            Schedule(it, if (raw.isNull("assignee_id")) Assignment.Everyone else Assignment.Person(raw.getInt("assignee_id")))
        }, assigneeName = raw.text("assignee_name"), creatorId = if (raw.isNull("creator_id")) null else raw.getInt("creator_id"), blocked = raw.optInt("blocked") > 0
    )
    val startDate get() = schedule?.startDate ?: ""
    val assignment get() = schedule?.assignment ?: Assignment.NoOne
    val effortHours get() = effortMinutes?.let { (it / 60.0).toString() } ?: ""
}
data class TaskDependency(val taskId: Int, val title: String)
data class TaskHistoryEvent(val name: String, val createdAt: String)
data class TaskDetails(val prerequisites: List<TaskDependency>, val history: List<TaskHistoryEvent>) {
    constructor(raw: JSONObject?) : this(
        raw?.rows("prerequisites")?.map { TaskDependency(it.getInt("prerequisite_task_id"), it.text("title")) } ?: emptyList(),
        raw?.rows("history")?.map { TaskHistoryEvent(it.text("event_type"), it.text("created_at")) } ?: emptyList()
    )
}
data class TaskEdit(val title: String, val details: String, val duration: String, val dueDate: String, val effortHours: String, val leadTimeDays: String)
sealed class TaskLocation {
    data object Now : TaskLocation()
    data object Backlog : TaskLocation()
    data class Project(val id: Int) : TaskLocation()
}

/** Only transport adapters see action names, routes and fields. */
data class TaskRequest(val view: String, val action: String, val fields: Map<String, String>, val query: String = "")
fun interface TaskTransport { fun submit(request: TaskRequest, done: () -> Unit) }
class TaskChange private constructor(private val request: TaskRequest) {
    fun send(transport: TaskTransport, done: () -> Unit = {}) = transport.submit(request, done)
    companion object {
        private fun editAction(name: String, vararg fields: Pair<String, String>) = TaskChange(TaskRequest("backlog", name, mapOf(*fields)))
        fun edit(id: Int, value: TaskEdit) = editAction("edit", "id" to "$id", "title" to value.title, "details" to value.details,
            "duration" to value.duration, "dueAt" to value.dueDate, "remainingHours" to value.effortHours, "leadTimeDays" to value.leadTimeDays.ifBlank { "0" })
        fun assign(id: Int, assignment: Assignment, startDate: String? = null): TaskChange {
            val person = when (assignment) { Assignment.NoOne -> "none"; Assignment.Everyone -> "everyone"; is Assignment.Person -> assignment.id.toString() }
            val fields = mapOf("taskId" to "$id", "assigneeId" to person) + (startDate?.let { mapOf("startDate" to it) } ?: emptyMap())
            return TaskChange(TaskRequest("backlog", "schedule", fields))
        }
        fun unschedule(id: Int) = TaskChange(TaskRequest("calendar", "unschedule", mapOf("taskId" to "$id")))
        fun queue(id: Int, queued: Boolean) = editAction("plan", "taskId" to "$id", "planned" to "$queued")
        fun complete(id: Int, completed: Boolean) = editAction("state", "id" to "$id", "state" to if (completed) "completed" else "open")
        fun delete(id: Int) = editAction("deleteTask", "id" to "$id")
        fun project(id: Int, projectId: Int, included: Boolean) = editAction(if (included) "addProject" else "removeProject", "taskId" to "$id", "projectId" to "$projectId")
        fun dependency(id: Int, prerequisite: Int, included: Boolean) = editAction(if (included) "dependency" else "removeDependency", "taskId" to "$id", "prerequisiteId" to "$prerequisite")
        fun create(title: String, location: TaskLocation): TaskChange = when (location) {
            TaskLocation.Now -> TaskChange(TaskRequest("now", "quickAdd", mapOf("title" to title)))
            TaskLocation.Backlog -> editAction("create", "title" to title)
            is TaskLocation.Project -> TaskChange(TaskRequest("project", "create", mapOf("title" to title), "id=${location.id}"))
        }
        fun focus(id: Int, focused: Boolean) = TaskChange(TaskRequest("now", "move", mapOf("id" to "$id", "section" to if (focused) "focus" else "also", "position" to "0")))
        /** Visible neighbors preserve filtered-out tasks when moving in Backlog or Project. */
        fun move(task: Task, visible: List<Task>, location: TaskLocation, delta: Int): TaskChange? {
            require(delta == -1 || delta == 1)
            val group = visible.filter { !it.completed && when (location) {
                TaskLocation.Now -> it.section == task.section
                TaskLocation.Backlog -> it.queued == task.queued
                is TaskLocation.Project -> true
            } }
            val index = group.indexOfFirst { it.id == task.id }
            if (index < 0 || index + delta !in group.indices) return null
            return when (location) {
                TaskLocation.Now -> TaskChange(TaskRequest("now", "move", mapOf("id" to "${task.id}", "section" to task.section, "position" to "${index + delta}")))
                else -> {
                    val fields = mapOf("taskId" to "${task.id}", "anchorId" to "${group[index + delta].id}", "edge" to if (delta < 0) "before" else "after")
                    if (location is TaskLocation.Project) TaskChange(TaskRequest("project", "move", fields, "id=${location.id}"))
                    else TaskChange(TaskRequest("backlog", "move", fields + ("group" to if (task.queued) "queued" else "unqueued")))
                }
            }
        }
    }
}
