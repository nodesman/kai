// diffview.cpp
#include "diffview.h"
#include "diffcontentwidget.h" // Include the new widget
#include "../../models/diffmodel.h"
#include <QPainter>
#include <QVBoxLayout>
#include <QMouseEvent>
#include <QListView>
#include <QSplitter>
#include <QWheelEvent>
#include <QScrollArea>
#include <QFontMetrics>

DiffView::DiffView(QWidget *parent)
    : QWidget(parent)
    , m_model(nullptr)
    , m_fileListView(new QListView(this))
    , m_scrollArea(new QScrollArea(this))
    , m_lineHeight(0) // Initialize
{
    setFocusPolicy(Qt::StrongFocus);

    // Main Layout
    QVBoxLayout *mainLayout = new QVBoxLayout(this);
    mainLayout->setContentsMargins(0, 0, 0, 0);

     QSplitter *splitter = new QSplitter(Qt::Vertical, this);
    mainLayout->addWidget(splitter);

    // Add file list
    splitter->addWidget(m_fileListView);
    splitter->addWidget(new QWidget());

    // Set the layout!
    setLayout(mainLayout);

    connect(m_fileListView, &QListView::clicked, this, &DiffView::onFileSelectionChanged);
}

DiffView::~DiffView() {
    // QScopedPointer handles deletion of m_diffContent
}

void DiffView::setModel(DiffModel *model) {
    m_model = model;
    if (m_fileListView) {
        m_fileListView->setModel(m_model);
    }
}
void DiffView::onFileSelectionChanged(const QModelIndex &index) {
    if (!m_model || !index.isValid()) {
        return;
    }

    QString fileContent = m_model->getFileContent(index.row());
    QList<DiffLine> diffData = parseDiffContent(fileContent);

    // Calculate line height *before* creating the content widget
    if (m_lineHeight == 0) {
        QFontMetrics fontMetrics(QFont("Courier New", 10));
        m_lineHeight = fontMetrics.height();
    }

    // Create or recreate the DiffContentWidget
    m_diffContent.reset(new DiffContentWidget(m_scrollArea)); // Pass scroll area as parent
    m_scrollArea->setWidget(m_diffContent.data()); // Set the new widget
    m_diffContent->setDiffData(diffData, m_lineHeight); // Pass the data

}

QList<DiffView::DiffLine> DiffView::parseDiffContent(const QString& content) {
   QList<DiffView::DiffLine> diffData;
    QStringList lines = content.split('\n');

    for (const QString& line : lines) {
        DiffLine diffLine;

        if (line.startsWith('+')) {
            diffLine.changeType = DiffLine::Added;
            diffLine.text = line.mid(1);
        } else if (line.startsWith('-')) {
            diffLine.changeType = DiffLine::Removed;
            diffLine.text = line.mid(1);
        } else {
            diffLine.changeType = DiffLine::Unchanged;
            diffLine.text = line;
        }

        diffData.append(diffLine);
    }

    return diffData;
}




void DiffView::mousePressEvent(QMouseEvent *event) {
    if (event->button() == Qt::RightButton) {
        emit requestDiffExplanation();
    }
    QWidget::mousePressEvent(event);
}

// No need for a paintEvent in DiffView now