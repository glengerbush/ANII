package org.anii.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.material3.*
import androidx.compose.ui.graphics.Color

/*
THESIS: ANII's daily planning, reachable one-handed with native Android controls.
OWN-WORLD: Inherit the web app's warm cream and teal; Material typography, sheets and touch targets.
STORY: Save the server once, choose a profile, capture and act on tasks with shared server rules.
FIRST VIEWPORT: A single URL field and Connect action; returning users enter Now with bottom navigation.
FORM: Native adaptation of the established ANII app; no new visual-world selection.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
*/
class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        receiveShare(intent)
        setContent {
            val dark = isSystemInDarkTheme()
            val ink = Color(if (dark) 0xFFCECDC3 else 0xFF100F0F)
            val ground = Color(if (dark) 0xFF100F0F else 0xFFFFFCF0)
            val surface = Color(if (dark) 0xFF1C1B1A else 0xFFFFFCF0)
            val container = Color(if (dark) 0xFF282726 else 0xFFF2F0E5)
            val teal = Color(if (dark) 0xFF3AA99F else 0xFF1D716A)
            val selected = Color(if (dark) 0xFF173E3A else 0xFFDDF1E4)
            val onSelected = Color(if (dark) 0xFFBCE5DD else 0xFF124D48)
            val base = if (dark) darkColorScheme() else lightColorScheme()
            val colors = base.copy(
                primary = teal, onPrimary = ground, primaryContainer = selected, onPrimaryContainer = onSelected,
                secondary = teal, onSecondary = ground, secondaryContainer = selected, onSecondaryContainer = onSelected,
                tertiary = teal, onTertiary = ground, tertiaryContainer = selected, onTertiaryContainer = onSelected,
                background = ground, onBackground = ink, surface = surface, onSurface = ink,
                surfaceVariant = container, onSurfaceVariant = Color(if (dark) 0xFFB7B5AC else 0xFF575653),
                surfaceTint = teal, outline = Color(if (dark) 0xFF878580 else 0xFF878580),
                outlineVariant = Color(if (dark) 0xFF403E3C else 0xFFDAD8CE),
                inverseSurface = ink, inverseOnSurface = ground, inversePrimary = teal,
                surfaceDim = container, surfaceBright = surface,
                surfaceContainerLowest = ground, surfaceContainerLow = surface,
                surfaceContainer = container, surfaceContainerHigh = container, surfaceContainerHighest = container
            )
            MaterialTheme(colorScheme = colors) {
                Surface(Modifier.fillMaxSize(), color = colors.background, contentColor = colors.onBackground) { AniiApp(model) }
            }
        }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); receiveShare(intent) }
    private fun receiveShare(intent: Intent?) {
        if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            model.sharedText = intent.getStringExtra(Intent.EXTRA_TEXT).orEmpty().take(10_000)
            intent.action = Intent.ACTION_MAIN
        }
    }
}
