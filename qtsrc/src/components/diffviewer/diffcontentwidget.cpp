#include "diffcontentwidget.h"
#include <QPainter>
#include <QPaintEvent>
#include <QScrollBar>
#include <QScrollArea>
#include <QPalette>
#include <algorithm>
#include <QDebug>

DiffContentWidget::DiffContentWidget(QWidget *parent)
    : QWidget(parent)
{
    QPalette palette = this->palette();
    palette.setColor(QPalette::Base, Qt::white);
    setPalette(palette);
    setBackgroundRole(QPalette::Base);
    setAutoFillBackground(true);
    setSizePolicy(QSizePolicy::Preferred, QSizePolicy::Fixed); // Important for layout
}

void DiffContentWidget::setDiffData(const QList<DiffView::DiffLine>& diffData, const QString& fileName) {
    m_diffData = diffData;
    m_fileName = fileName;

    // Calculate line numbers *here*, within the content widget.
    int originalLine = 1;
    int modifiedLine = 1;
    for (int i = 0; i < m_diffData.size(); ++i) {
        DiffView::DiffLine& line = m_diffData[i]; // Modify directly

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

    updateGeometry(); // VERY IMPORTANT: Trigger recalculation of sizeHint
    update(); // Trigger a repaint
}

QSize DiffContentWidget::calculateContentSize() const {
    if (m_diffData.isEmpty()) {
        return QSize(0, 0);
    }

    QFont font("Courier New", 12); // Consistent font
    QFontMetrics fontMetrics(font);
    int lineHeight = fontMetrics.height(); // Calculate line height *here*
    const int padding = 3;

    int maxLineNumber = 0;
    for (const auto& line : m_diffData) {
        maxLineNumber = std::max(maxLineNumber, line.originalLineNumber);
        maxLineNumber = std::max(maxLineNumber, line.modifiedLineNumber);
    }

    QString maxLineNumStr = QString::number(maxLineNumber);
    int lineNumberWidth =  fontMetrics.horizontalAdvance(maxLineNumStr + "  ");
    int maxWidth = lineNumberWidth;

     for (const DiffView::DiffLine& line : m_diffData) {
        //Crucial, elide text longer than parent width.
        QString elidedText = fontMetrics.elidedText(line.text, Qt::ElideRight, this->width() - lineNumberWidth - 10);
        QRect boundingRect = fontMetrics.boundingRect(elidedText); // Use bounding rect for accurate width
        maxWidth = qMax(maxWidth, boundingRect.width() + lineNumberWidth);
    }

    const int fileNameAreaHeight = 30;
    int totalHeight = m_diffData.size() * (lineHeight + padding) + fileNameAreaHeight;

    return QSize(maxWidth + 10, totalHeight); // Add some extra width
}

QSize DiffContentWidget::sizeHint() const {
    return calculateContentSize();
}

void DiffContentWidget::paintEvent(QPaintEvent *event) {
    QPainter painter(this);
    QFont font("Courier New", 12);
    painter.setFont(font);

    QFontMetrics fontMetrics(font);
    int lineHeight = fontMetrics.height(); // Get line height from painter
    const int padding = 3;
    const int fileNameAreaHeight = 30; // Height for the file name area
    const int leftPadding = 5;

    // --- Draw File Name Area ---
    QRect fileNameRect(0, 0, width(), fileNameAreaHeight);
    painter.fillRect(fileNameRect, QColor(230, 230, 230)); // Light grey background
    painter.setPen(QColor(180, 180, 180)); // Darker grey for shadow
    painter.drawLine(0, fileNameAreaHeight, width(), fileNameAreaHeight);
    painter.setPen(Qt::black); // Black text
    painter.drawText(leftPadding, fileNameAreaHeight - (fileNameAreaHeight - lineHeight)/2 - fontMetrics.descent() , m_fileName);  // Draw text

    int yPos = fileNameAreaHeight;

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
        yPos = (i * (lineHeight + padding)) + fileNameAreaHeight + padding;

        if (!event->rect().intersects(QRect(0, yPos, width(), lineHeight + padding))) {
            continue;
        }

        switch (line.changeType) {
            case DiffView::DiffLine::Unchanged:
                painter.setPen(Qt::black);
                break;
            case DiffView::DiffLine::Added:
                painter.setPen(Qt::darkGreen);
                painter.fillRect(0, yPos, width(), lineHeight + padding, QColor(220, 255, 220));
                break;
            case DiffView::DiffLine::Removed:
                painter.setPen(Qt::darkRed);
                painter.fillRect(0, yPos, width(), lineHeight + padding, QColor(255, 220, 220));
                break;
        }

        QString lineNumberStr;
        if (line.changeType == DiffView::DiffLine::Added) {
            lineNumberStr = QString::number(line.modifiedLineNumber);
        } else {
            lineNumberStr = QString::number(line.originalLineNumber);
        }
        if (lineNumberStr == "0") {
            lineNumberStr = "";
        }

         //Crucial, elide text longer than parent width.
        QString elidedText = fontMetrics.elidedText(line.text, Qt::ElideRight, this->width() - lineNumberWidth - 10);
        painter.drawText(leftPadding, yPos + lineHeight - fontMetrics.descent(), lineNumberStr);
        painter.drawText(5 + lineNumberWidth, yPos + lineHeight - fontMetrics.descent(), elidedText);
    }
     drawScrollbarMarkers(&painter);
}
void DiffContentWidget::resizeEvent(QResizeEvent *event) {
    QWidget::resizeEvent(event);
    updateGeometry(); // Recalculate sizeHint on resize
    update(); // and repaint.
}

void DiffContentWidget::drawScrollbarMarkers(QPainter *painter)
{
    if (m_diffData.isEmpty() || !parentWidget()) {
        return;
    }

    QScrollArea* scrollArea = qobject_cast<QScrollArea*>(parentWidget());
    if (!scrollArea) {
        return;
    }
    QScrollBar *verticalScrollBar = scrollArea->verticalScrollBar();
     if (!verticalScrollBar) {
        return; // No vertical scrollbar, nothing to do
    }

    painter->setPen(Qt::NoPen);
    painter->setBrush(QColor(100, 100, 100, 128));

    const int scrollBarWidth = verticalScrollBar->width();
    const int viewHeight = scrollArea->viewport()->height();
    const int totalLines = m_diffData.size();

    //Iterate and check directly
    for (int i = 0; i < totalLines; ++i) {
        if(m_diffData[i].changeType != DiffView::DiffLine::Unchanged){
            int markerY = (i * viewHeight) / totalLines;
            painter->drawRect(width() - scrollBarWidth, markerY, scrollBarWidth, 3);
        }
    }
}