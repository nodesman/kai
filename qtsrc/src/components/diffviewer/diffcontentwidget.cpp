#include "diffcontentwidget.h"
#include <QPainter>
#include <QPaintEvent>
#include <QScrollBar>
#include <QScrollArea>
#include <QPalette>
#include <algorithm>

DiffContentWidget::DiffContentWidget(QWidget *parent)
    : QWidget(parent)
    , m_lineHeight(0)
    , m_firstChangeLine(-1)
{
    QPalette palette = this->palette();
    palette.setColor(QPalette::Base, Qt::white);
    setPalette(palette);
    setBackgroundRole(QPalette::Base);
    setAutoFillBackground(true);
}

void DiffContentWidget::setDiffData(const QList<DiffView::DiffLine>& diffData, const QString& fileName) {
    m_diffData = diffData;
    m_fileName = fileName;

    m_firstChangeLine = -1;
    m_changeLines.clear();

    // Calculate line numbers *here*, within the content widget.
    int originalLine = 1;
    int modifiedLine = 1;
    for (int i = 0; i < m_diffData.size(); ++i) {
        DiffView::DiffLine& line = m_diffData[i]; // Modify directly

        if (line.changeType != DiffView::DiffLine::Unchanged) {
            if (m_firstChangeLine == -1) {
                m_firstChangeLine = i;
            }
            m_changeLines.append(i);
        }

        // Assign line numbers based on change type
        switch (line.changeType) {
            case DiffView::DiffLine::Added:
                line.originalLineNumber = 0; // No original line
                line.modifiedLineNumber = modifiedLine++;
                break;
            case DiffView::DiffLine::Removed:
                line.originalLineNumber = originalLine++;
                line.modifiedLineNumber = 0; // No modified line
                break;
            case DiffView::DiffLine::Unchanged:
                line.originalLineNumber = originalLine++;
                line.modifiedLineNumber = modifiedLine++;
                break;
        }
    }

    updateGeometry();
    update();
}

QSize DiffContentWidget::sizeHint() const {
    if (m_diffData.isEmpty()) {
        return QSize(0, 0);
    }

    QFontMetrics fontMetrics(QFont("Courier New", 12));
    int maxLineNumber = 0;
    for (const auto& line : m_diffData) {
        maxLineNumber = std::max(maxLineNumber, line.originalLineNumber);
        maxLineNumber = std::max(maxLineNumber, line.modifiedLineNumber);
    }

    int lineNumberWidth = fontMetrics.horizontalAdvance(QString::number(maxLineNumber) + "  ");
    int maxWidth = lineNumberWidth;
    for (const auto& line : m_diffData) {
        int lineWidth = fontMetrics.horizontalAdvance(line.text);
        maxWidth = qMax(maxWidth, lineWidth + lineNumberWidth);
    }

    int totalHeight = m_diffData.size() * (m_lineHeight + 3);
     if (m_lineHeight == 0)
        totalHeight = m_diffData.size() * (fontMetrics.height() + 3); //for set diff data before paint event

    return QSize(maxWidth + 10, totalHeight);
}

void DiffContentWidget::paintEvent(QPaintEvent *event) {
    QPainter painter(this);
    painter.setFont(QFont("Courier New", 12));

    if (m_lineHeight == 0) {
        m_lineHeight = painter.fontMetrics().height();
    }
    const int padding = 3;

    painter.setPen(Qt::black);
    painter.drawText(5, m_lineHeight, m_fileName);
    int yPos = m_lineHeight + padding + 3;

    QFontMetrics fontMetrics(painter.font());
    int maxLineNumber = 0;
    for(const auto& line: m_diffData)
    {
         maxLineNumber = std::max(maxLineNumber, line.originalLineNumber);
         maxLineNumber = std::max(maxLineNumber, line.modifiedLineNumber);
    }

    QString maxLineNumStr = QString::number(maxLineNumber);
    int lineNumberWidth =  fontMetrics.horizontalAdvance(maxLineNumStr + "  ");


    for (int i = 0; i < m_diffData.size(); ++i) {
        const DiffView::DiffLine& line = m_diffData[i];
        yPos = (i * (m_lineHeight + padding)) + m_lineHeight + padding ;

        if (!event->rect().intersects(QRect(0, yPos, width(), m_lineHeight + padding))) {
            continue;
        }

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

        QString lineNumberStr;
        if (line.changeType == DiffView::DiffLine::Added) {
            lineNumberStr = QString::number(line.modifiedLineNumber);
        } else {
            lineNumberStr = QString::number(line.originalLineNumber);
        }
         // Handle zero line numbers (display as empty)
        if (lineNumberStr == "0") {
            lineNumberStr = "";
        }
        painter.drawText(5, yPos + m_lineHeight - painter.fontMetrics().descent(), lineNumberStr);
        painter.drawText(5 + lineNumberWidth, yPos + m_lineHeight - painter.fontMetrics().descent(), line.text);
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