// diffcontentwidget.cpp
#include "diffcontentwidget.h"
#include <QPainter>
#include <QPaintEvent>
#include <QScrollBar> //For markers
#include <QScrollArea> // Include the full definition of QScrollArea


DiffContentWidget::DiffContentWidget(QWidget *parent)
    : QWidget(parent)
    , m_lineHeight(0)
    , m_firstChangeLine(-1)
{
    setBackgroundRole(QPalette::Base);
    setAutoFillBackground(true);
}

void DiffContentWidget::setDiffData(const QList<DiffView::DiffLine>& diffData, int lineHeight) {
    m_diffData = diffData;
    m_lineHeight = lineHeight;

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

    QFontMetrics fontMetrics(QFont("Courier New", 10)); // Consistent font
     for (const auto& line : m_diffData)
    {
       int lineWidth = fontMetrics.horizontalAdvance(line.text);
       maxWidth = qMax(maxWidth, lineWidth);
    }
    return QSize(maxWidth + 10, totalHeight);
}

void DiffContentWidget::paintEvent(QPaintEvent *event) {
    QPainter painter(this);
    painter.setFont(QFont("Courier New", 10));

    const int padding = 3;
     // Start drawing from the top

     //Since it is repainted, recalculate the height
     if (m_lineHeight == 0)
        m_lineHeight = painter.fontMetrics().height();

    //No need to use ScrollOffset we will get the relative paint event

    for (int i = 0; i < m_diffData.size(); ++i)
    {
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
    if (m_changeLines.isEmpty() || m_diffData.isEmpty() || !parentWidget()) { // Check parentWidget
        return;
    }

    QScrollArea* scrollArea = qobject_cast<QScrollArea*>(parentWidget());
      if (!scrollArea) {
        return; // Safety check: Parent is not a QScrollArea
    }

    painter->setPen(Qt::NoPen);
    painter->setBrush(QColor(100, 100, 100, 128));

    const int scrollBarWidth = scrollArea->verticalScrollBar()->width();
    const int viewHeight = scrollArea->viewport()->height(); // Use viewport
    const int totalLines = m_diffData.size();

    for (int changedLine : m_changeLines) {
        int markerY = (changedLine * viewHeight) / totalLines;
        painter->drawRect(width() - scrollBarWidth, markerY, scrollBarWidth, 3); //Correct width
    }
}