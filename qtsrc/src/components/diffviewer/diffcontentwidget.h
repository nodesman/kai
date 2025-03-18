// diffcontentwidget.h
#ifndef DIFFCONTENTWIDGET_H
#define DIFFCONTENTWIDGET_H

#include <QWidget>
#include <QList>
#include "diffview.h" // For DiffLine

class QPaintEvent;
class QPainter;
class QResizeEvent; // Add QResizeEvent

class DiffContentWidget : public QWidget {
    Q_OBJECT

public:
    DiffContentWidget(QWidget *parent = nullptr);
    void setDiffData(const QList<DiffView::DiffLine>& diffData, const QString& fileName);

    // CRUCIAL: Override sizeHint()
    QSize sizeHint() const override;

private:
    QList<DiffView::DiffLine> m_diffData;
    QString m_fileName;

    // Helper function to calculate the required size (Good practice - keep sizeHint() clean)
    QSize calculateContentSize() const;

    //Change these to private, calculate them
    //QList<int> m_changeLines;   // Remove - not needed as a member
    //int m_firstChangeLine;       // Remove - not needed as a member
    //int m_lineHeight;            // Remove - calculated in calculateContentSize()

protected:
    void paintEvent(QPaintEvent *event) override;
    void resizeEvent(QResizeEvent *event) override; // Handle resize events!

    // Consider making this private if it's only used internally
    void drawScrollbarMarkers(QPainter *painter);
};

#endif // DIFFCONTENTWIDGET_H