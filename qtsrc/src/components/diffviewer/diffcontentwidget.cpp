// diffcontentwidget.cpp
#include "diffcontentwidget.h"
#include <QPainter>
#include <QPaintEvent>
#include <QScrollBar>
#include <QScrollArea>
#include <QPalette> // For setting the background color

DiffContentWidget::DiffContentWidget(QWidget *parent)
    : QWidget(parent)
    , m_lineHeight(0)
    , m_firstChangeLine(-1)
{
    // Set the background color to white explicitly.
    QPalette palette = this->palette();
    palette.setColor(QPalette::Base, Qt::white);
    setPalette(palette);
    setBackgroundRole(QPalette::Base); // Still needed
    setAutoFillBackground(true); // Still needed
}

void DiffContentWidget::setDiffData(const QList<DiffView::DiffLine>& diffData, int lineHeight) {
    m_diffData = diffData;
    m_lineHeight = lineHeight;  //This might be wrong, calculate again

    m_firstChangeLine = -1;
    m_changeLines.clear();
    for (int i = 0; i < m_diffData.size(); ++i) {
        if (m_diffData[i].changeType != DiffView::DiffLine::Unchanged) {
            if (m_firstChangeLine == -1) {
                m_firstChangeLine = i;
            }
            m_changeLines.append(i);
        }
    }

    // Important: Update the widget's size.  This informs the QScrollArea.
    updateGeometry(); // This triggers sizeHint() to be called
    update(); // And trigger a repaint
}

QSize DiffContentWidget::sizeHint() const {
    if (m_diffData.isEmpty()) {
        return QSize(0, 0);
    }
    int totalHeight = m_diffData.size() * (m_lineHeight + 3);
    int maxWidth = 0;

    QFontMetrics fontMetrics(QFont("Courier New", 12)); // Use 12pt font here
    for (const auto& line : m_diffData)
    {
        int lineWidth = fontMetrics.horizontalAdvance(line.text);
        maxWidth = qMax(maxWidth, lineWidth);
    }
    return QSize(maxWidth + 10, totalHeight);
}

void DiffContentWidget::paintEvent(QPaintEvent *event) {
    QPainter painter(this);
    painter.setFont(QFont("Courier New", 12)); // 12pt font

    // Recalculate line height based on the new font
     if (m_lineHeight == 0)
        m_lineHeight = painter.fontMetrics().height();

    const int padding = 3;
    // y is not used, so no need to initialize it

    for (int i = 0; i < m_diffData.size(); ++i) {
        const DiffView::DiffLine& line = m_diffData[i];
        int yPos = (i * (m_lineHeight + padding));


        //optimization
        if (!event->rect().intersects(QRect(0,yPos, width(), m_lineHeight + padding)))
        {
            continue;
        }

        // Set color based on change type
        switch (line.changeType) {
            case DiffView::DiffLine::Unchanged:
                painter.setPen(Qt::black);
                break;
            case DiffView::DiffLine::Added:
                painter.setPen(Qt::darkGreen);
                painter.fillRect(0, yPos, width(), m_lineHeight + padding, QColor(220, 255, 220));
                break;
            case DiffView::DiffLine::Removed:
                painter.setPen(Qt::darkRed);
                painter.fillRect(0, yPos, width(), m_lineHeight + padding, QColor(255, 220, 220));
                break;
        }
         painter.drawText(5, yPos + m_lineHeight - painter.fontMetrics().descent(), line.text);
    }
    drawScrollbarMarkers(&painter);
}

void DiffContentWidget::drawScrollbarMarkers(QPainter *painter)
{
    if (m_changeLines.isEmpty() || m_diffData.isEmpty() || !parentWidget()) {
        return;
    }

    QScrollArea* scrollArea = qobject_cast<QScrollArea*>(parentWidget());
    if (!scrollArea) {
        return;
    }

    painter->setPen(Qt::NoPen);
    painter->setBrush(QColor(100, 100, 100, 128));

    const int scrollBarWidth = scrollArea->verticalScrollBar()->width();
    const int viewHeight = scrollArea->viewport()->height();
    const int totalLines = m_diffData.size();

    for (int changedLine : m_changeLines) {
        int markerY = (changedLine * viewHeight) / totalLines;
        painter->drawRect(width() - scrollBarWidth, markerY, scrollBarWidth, 3);
    }
}