#include "diffview.h"
#include <QPainter>
#include <QTextLayout> // For more advanced text layout (if needed later)

DiffView::DiffView(QWidget *parent)
    : QWidget(parent)
{
    // Set a fixed size for initial simplicity.  You'd likely want
    // to make this scrollable in a real application.
    setFixedSize(800, 600);
    // Could also use: setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Expanding);
}

void DiffView::setDiffData(const QList<DiffLine>& diffData)
{
    m_diffData = diffData;
    update(); // Trigger a repaint
}


void DiffView::paintEvent(QPaintEvent *event)
{
    Q_UNUSED(event); // We don't use the event parameter in this simple example

    QPainter painter(this);
    painter.setFont(QFont("Courier New", 10)); // Monospaced font is best for diffs

    // Fill the background with white
    painter.fillRect(rect(), Qt::white);

    int lineHeight = QFontMetrics(painter.font()).height();
    int padding = 3; // 3 pixels of padding

    int y = 0; // Starting Y position for drawing

    for (const DiffLine& line : m_diffData) {
        // Set color based on change type
        switch (line.changeType) {
            case Unchanged:
                painter.setPen(Qt::black); // or palette().text()
            break;
            case Added:
                painter.setPen(Qt::darkGreen);
            painter.fillRect(0, y, width(), lineHeight + padding, QColor(220, 255, 220)); // Light green background
            break;
            case Removed:
                painter.setPen(Qt::darkRed);
            painter.fillRect(0, y, width(), lineHeight + padding, QColor(255, 220, 220)); // Light red background
            break;
        }

        // Draw the text.  QPainter::drawText() is simple but limited.
        // For more control (e.g., inline + and - symbols), use QTextLayout.
        painter.drawText(0, y + lineHeight, line.text);

        y += lineHeight + padding; // Move to the next line with padding.
    }
}