// diffcontentwidget.h
#ifndef DIFFCONTENTWIDGET_H
#define DIFFCONTENTWIDGET_H

#include <QWidget>
#include <QList>
#include "diffview.h" // Include for DiffLine struct (move DiffLine if needed)

class QPaintEvent;
class QPainter;

class DiffContentWidget : public QWidget {
    Q_OBJECT

public:
    DiffContentWidget(QWidget *parent = nullptr);
    void setDiffData(const QList<DiffView::DiffLine>& diffData, int lineHeight);
    QSize sizeHint() const override;  // Important for QScrollArea

protected:
    void paintEvent(QPaintEvent *event) override;
    void drawScrollbarMarkers(QPainter *painter);

private:
    QList<DiffView::DiffLine> m_diffData;
    QList<int> m_changeLines;
    int m_firstChangeLine;
    int m_lineHeight;
};

#endif // DIFFCONTENTWIDGET_H