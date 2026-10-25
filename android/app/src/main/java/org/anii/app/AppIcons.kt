package org.anii.app

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

object AppIcons {
    val Bolt = ImageVector.Builder("Now", 24.dp, 24.dp, 24f, 24f).apply {
        path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineJoin = StrokeJoin.Round, strokeLineCap = StrokeCap.Round) {
            moveTo(13f, 3f); lineTo(5f, 14f); lineTo(11f, 14f); lineTo(10f, 21f); lineTo(19f, 10f); lineTo(13f, 10f); close()
        }
    }.build()
    val Folder = ImageVector.Builder("Projects", 24.dp, 24.dp, 24f, 24f).apply {
        path(stroke = SolidColor(Color.Black), strokeLineWidth = 1.8f, strokeLineJoin = StrokeJoin.Round) {
            moveTo(3f, 5f); lineTo(9f, 5f); lineTo(11f, 7f); lineTo(21f, 7f); lineTo(21f, 19f); lineTo(3f, 19f); close()
        }
    }.build()
}
